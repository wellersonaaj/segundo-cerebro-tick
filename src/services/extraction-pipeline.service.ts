import type { SupabaseClient } from '@supabase/supabase-js';
import { getMemoryCompilerMode, isExtractorV14ShadowEnabled, isGreenfieldSchemaEnabled, loadEnv } from '../config/env.js';
import type { ExtractFn } from '../openai/extractor.service.js';
import {
  EXTRACTOR_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from '../openai/extractor.prompt.js';
import { ExtractionRunRpcRepository } from '../repositories/extraction-run-rpc.repository.js';
import { ExtractionRunsRepository } from '../repositories/extraction-runs.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type {
  ExtractionTriggerType,
  InboxItem,
  ProcessInboxResult,
  SourceMode,
} from '../types/domain.js';
import { log } from '../utils/logger.js';
import {
  applyBootstrapAssertionReview,
  mergeBootstrapAssertionReview,
} from './bootstrap-assertion-review.js';
import { EffectiveInputBuilder } from './effective-input.builder.js';
import { applyPostResolutionSanitization } from './extraction-sanitizer.service.js';
import { MemoryResolverService } from './memory-resolver.service.js';
import { PersistenceService } from './persistence.service.js';
import { ClarificationManagerService } from './clarification-manager.service.js';
import {
  hashContentForShadow,
  MemoryCompilerService,
  summarizeCompiledForShadow,
} from './memory-compiler.service.js';
import { ExtractorV14ShadowService } from './extractor-v14-shadow.service.js';

export interface RunPipelineInput {
  inboxItem: InboxItem;
  triggerType: ExtractionTriggerType;
  inputContent: string;
  inputContentHash: string;
  correctionId?: string | null;
  sourceChannel?: string;
  sourceMode?: SourceMode;
  receivedAt?: string;
  timezone?: string;
}

export class ExtractionPipelineService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly runRpc: ExtractionRunRpcRepository;
  private readonly runsRepo: ExtractionRunsRepository;
  private readonly effectiveInput: EffectiveInputBuilder;
  private readonly memoryCompiler = new MemoryCompilerService();
  private readonly clarificationManager = new ClarificationManagerService();
  private readonly extractorV14Shadow: ExtractorV14ShadowService;

  constructor(
    db: SupabaseClient,
    private readonly extract: ExtractFn,
    private readonly memoryResolver: MemoryResolverService,
    private readonly persistence: PersistenceService,
    extractorV14Shadow?: ExtractorV14ShadowService,
  ) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.runRpc = new ExtractionRunRpcRepository(db);
    this.runsRepo = new ExtractionRunsRepository(db);
    this.effectiveInput = new EffectiveInputBuilder(db);
    this.extractorV14Shadow = extractorV14Shadow ?? new ExtractorV14ShadowService(db);
  }

  async runPipeline(input: RunPipelineInput): Promise<ProcessInboxResult> {
    const env = loadEnv();
    const inbox = input.inboxItem;
    let runId: string | null = null;

    try {
      const start = await this.runRpc.startExtractionRun({
        inboxItemId: inbox.id,
        triggerType: input.triggerType,
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        modelName: env.OPENAI_MODEL,
        correctionId: input.correctionId ?? null,
        inputContentHash: input.inputContentHash,
      });
      runId = start.run_id;

      log('info', 'inbox_flow', {
        step: 'extraction_run_started',
        inbox_item_id: inbox.id,
        run_id: runId,
        trigger_type: input.triggerType,
      });

      const output = await this.extract({
        inbox_item_id: inbox.id,
        raw_content: input.inputContent,
        source_channel: input.sourceChannel ?? inbox.source_channel,
        source_mode: input.sourceMode ?? inbox.source_mode,
        received_at: input.receivedAt ?? inbox.received_at,
        timezone: input.timezone ?? inbox.timezone,
      });

      await this.runsRepo.saveRawOutput(runId, JSON.stringify(output), output);

      const resolvedMap = await this.memoryResolver.resolveEntities(
        inbox.id,
        output.entities,
        input.inputContent,
        runId,
      );

      const clarificationFilter = this.memoryResolver.filterClarifications(
        output.clarification_requests,
        resolvedMap,
        resolvedMap.resolutions,
      );

      const sanitizedOutput = applyPostResolutionSanitization(
        output,
        resolvedMap,
        clarificationFilter,
      );

      const assertionReview = applyBootstrapAssertionReview(
        input.sourceChannel ?? inbox.source_channel,
        sanitizedOutput,
      );
      const outputForPersistence = mergeBootstrapAssertionReview(
        sanitizedOutput,
        assertionReview,
      );

      let shadowOutput: Awaited<ReturnType<ExtractorV14ShadowService['runShadow']>> = null;

      if (isExtractorV14ShadowEnabled()) {
        try {
          shadowOutput = await this.extractorV14Shadow.runShadow({
            inboxItem: inbox,
            runId,
            inputContentHash: input.inputContentHash,
            v13EntityCount: outputForPersistence.entities.length,
            v13EventCount: outputForPersistence.events.length,
          });
        } catch (shadowV14Err) {
          log('error', 'extractor_v14_shadow_failed', {
            inbox_item_id: inbox.id,
            run_id: runId,
            error:
              shadowV14Err instanceof Error ? shadowV14Err.message : String(shadowV14Err),
          });
          if (isGreenfieldSchemaEnabled()) {
            throw shadowV14Err;
          }
        }
      }

      let persistResult: Awaited<ReturnType<PersistenceService['persistCandidates']>> | null =
        null;

      if (!isGreenfieldSchemaEnabled()) {
        persistResult = await this.persistence.persistCandidates(
          inbox.id,
          runId,
          outputForPersistence,
          resolvedMap,
          outputForPersistence.clarification_requests,
          input.receivedAt ?? inbox.received_at,
          input.timezone ?? inbox.timezone,
          input.sourceChannel ?? inbox.source_channel,
          input.correctionId ?? undefined,
        );
      } else if (!isExtractorV14ShadowEnabled()) {
        throw new Error('GREENFIELD_SCHEMA_REQUIRES_EXTRACTOR_V14_SHADOW');
      }

      await this.runsRepo.markValidated(runId);

      await this.runRpc.promoteExtractionRun(runId);

      const persistV2 = shadowOutput?.persistV2;
      const v2TaskCreates = persistV2?.taskMutationIds.length ?? 0;

      if (getMemoryCompilerMode() === 'shadow') {
        try {
          const inputHash = hashContentForShadow(input.inputContent);
          const compiled = this.memoryCompiler.compile({
            rawContent: input.inputContent,
            sourceChannel: input.sourceChannel ?? inbox.source_channel,
            sourceMode: input.sourceMode ?? inbox.source_mode,
            extractorOutput: output,
            resolvedMap,
          });
          const recommended = this.clarificationManager.recommend({
            suggestedClarifications: output.clarification_requests,
            resolvedMap,
            compilerFlags: compiled.flags,
          });
          const shadowSummary = summarizeCompiledForShadow(compiled, inputHash);
          log('info', 'memory_compiler_shadow', {
            inbox_item_id: inbox.id,
            run_id: runId,
            input_content_hash: inputHash,
            current_entity_count: outputForPersistence.entities.length,
            current_event_count: outputForPersistence.events.length,
            current_clarification_count: outputForPersistence.clarification_requests.length,
            compiled: shadowSummary,
            recommended_clarification_count: recommended.length,
          });
        } catch (compilerErr) {
          log('error', 'memory_compiler_shadow_failed', {
            inbox_item_id: inbox.id,
            run_id: runId,
            error: compilerErr instanceof Error ? compilerErr.message : String(compilerErr),
          });
        }
      }

      log('info', 'inbox_flow', {
        step: 'extraction_run_promoted',
        inbox_item_id: inbox.id,
        run_id: runId,
      });

      return {
        inbox_item_id: inbox.id,
        extraction_run_id: runId,
        processing_status: 'completed',
        has_active_memory: true,
        extractor_version: EXTRACTOR_VERSION,
        entities_created: persistResult?.entitiesCreated ?? persistV2?.entityIds.size ?? 0,
        entities_resolved: persistResult?.entitiesResolved ?? 0,
        events_created: persistResult?.eventIds.length ?? persistV2?.eventIds.length ?? 0,
        assertions_created: persistResult?.assertionIds.length ?? persistV2?.assertionIds.length ?? 0,
        tasks_created: persistResult?.taskIds.length ?? v2TaskCreates,
        clarifications_pending:
          persistResult?.clarificationIds.length ?? persistV2?.clarificationIds.length ?? 0,
        clarifications_resolved_automatically: clarificationFilter.autoResolvedIndices.length,
        requires_review: outputForPersistence.requires_review,
        review_reasons: outputForPersistence.review_reasons,
        processing_notes: outputForPersistence.processing_notes,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (runId) {
        try {
          await this.runRpc.failExtractionRun(runId, message);
        } catch (failErr) {
          log('error', 'inbox_flow', {
            step: 'fail_extraction_run_error',
            run_id: runId,
            error: failErr instanceof Error ? failErr.message : String(failErr),
          });
        }
      }
      log('error', 'inbox processing failed', {
        inbox_item_id: inbox.id,
        run_id: runId,
        error: message,
      });
      throw err;
    }
  }

  getEffectiveInputBuilder(): EffectiveInputBuilder {
    return this.effectiveInput;
  }

  getInboxRepo(): InboxItemsRepository {
    return this.inboxRepo;
  }

  getRunsRepo(): ExtractionRunsRepository {
    return this.runsRepo;
  }
}
