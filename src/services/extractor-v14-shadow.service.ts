import type { SupabaseClient } from '@supabase/supabase-js';
import { isExtractorV14ShadowEnabled, isPersistCompiledMemoryV2Enabled } from '../config/env.js';
import type { ExtractV14Fn } from '../openai/extractor-v1.4.service.js';
import { createOpenAiExtractorV14 } from '../openai/extractor-v1.4.service.js';
import { ExtractionRunsV2Repository } from '../repositories/v2/extraction-runs-v2.repository.js';
import type { InboxItem } from '../types/domain.js';
import { log } from '../utils/logger.js';
import { ExtractorV14CompileService } from './extractor-v14-compile.service.js';
import {
  buildExtractorV14ShadowSafeLog,
  type ExtractorV14ShadowSafeLog,
} from './extractor-v14-shadow-log.js';
import { PersistenceV2Service } from './persistence-v2.service.js';
import type { PersistenceV2Result } from '../types/domain-v2.js';

export interface ExtractorV14ShadowRunOutput {
  safeLog: ExtractorV14ShadowSafeLog;
  persistV2?: PersistenceV2Result;
}

export interface ExtractorV14ShadowRunInput {
  inboxItem: InboxItem;
  runId: string;
  inputContentHash: string;
  v13EntityCount?: number;
  v13EventCount?: number;
}

export class ExtractorV14ShadowService {
  private readonly compileService: ExtractorV14CompileService;
  private readonly runsV2Repo: ExtractionRunsV2Repository;
  private readonly persistenceV2: PersistenceV2Service;

  constructor(
    db: SupabaseClient,
    extractV14: ExtractV14Fn = createOpenAiExtractorV14(),
  ) {
    this.compileService = new ExtractorV14CompileService(db, extractV14);
    this.runsV2Repo = new ExtractionRunsV2Repository(db);
    this.persistenceV2 = new PersistenceV2Service(db);
  }

  async runShadow(input: ExtractorV14ShadowRunInput): Promise<ExtractorV14ShadowRunOutput | null> {
    if (!isExtractorV14ShadowEnabled()) {
      return null;
    }

    const started = Date.now();
    const inbox = input.inboxItem;
    let persistV2: PersistenceV2Result | undefined;

    const {
      output,
      effectiveInput,
      compiled,
      clarificationMateriality,
      finalDecision,
      resolverResult,
      taskSignalResolutions,
    } = await this.compileService.compileFromInbox(inbox);

    const recommended = clarificationMateriality.blocking;

    if (isPersistCompiledMemoryV2Enabled()) {
      await this.runsV2Repo.saveRawOutput(input.runId, JSON.stringify(output), output);
      await this.runsV2Repo.saveCompiledOutput(
        input.runId,
        compiled,
        finalDecision as unknown as Record<string, unknown>,
      );

      persistV2 = await this.persistenceV2.persistCandidates({
        inboxItemId: inbox.id,
        extractionRunId: input.runId,
        compiled,
        clarifications: clarificationMateriality,
        resolverResult,
        taskSignalResolutions,
        contextResolutionEvidence: compiled.contextResolutionEvidence,
      });

      log('info', 'compiled_memory_v2_persisted', {
        inbox_item_id: inbox.id,
        run_id: input.runId,
        task_mutations: persistV2.taskMutationIds.length,
        events: persistV2.eventIds.length,
        assertions: persistV2.assertionIds.length,
        clarifications: persistV2.clarificationIds.length,
      });
    }

    const safeLog = buildExtractorV14ShadowSafeLog({
      inboxItemId: inbox.id,
      runId: input.runId,
      effectiveInput,
      compiled,
      recommendedClarificationCount: recommended.length,
      finalDecisionStatus: finalDecision.status,
      durationMs: Date.now() - started,
      v13EntityCount: input.v13EntityCount,
      v13EventCount: input.v13EventCount,
    });

    log('info', 'extractor_v14_shadow', safeLog as unknown as Record<string, unknown>);

    return { safeLog, persistV2 };
  }
}
