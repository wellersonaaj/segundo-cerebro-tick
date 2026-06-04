import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../config/env.js';
import type { ExtractV14Fn } from '../openai/extractor-v1.4.service.js';
import { createOpenAiExtractorV14 } from '../openai/extractor-v1.4.service.js';
import {
  EXTRACTOR_V14_PROMPT_VERSION,
  EXTRACTOR_V14_SCHEMA_VERSION,
  EXTRACTOR_V14_VERSION,
} from '../openai/extractor-v1.4.prompt.js';
import { ExtractionRunRpcRepository } from '../repositories/extraction-run-rpc.repository.js';
import { ExtractionRunsV2Repository } from '../repositories/v2/extraction-runs-v2.repository.js';
import type { InboxItem } from '../types/domain.js';
import { log } from '../utils/logger.js';
import { ExtractorV14CompileService } from './extractor-v14-compile.service.js';
import type { InboxItemProcessPipeline } from './inbox-item-process.service.js';
import { hashContentForShadow } from './memory-compiler.service.js';
import { PersistenceV2Service } from './persistence-v2.service.js';

export class ExtractionPipelineV14Service implements InboxItemProcessPipeline {
  private readonly runRpc: ExtractionRunRpcRepository;
  private readonly runsV2Repo: ExtractionRunsV2Repository;
  private readonly persistenceV2: PersistenceV2Service;
  private readonly compileService: ExtractorV14CompileService;

  constructor(
    db: SupabaseClient,
    extractV14: ExtractV14Fn = createOpenAiExtractorV14(),
    deps?: {
      runRpc?: ExtractionRunRpcRepository;
      runsV2Repo?: ExtractionRunsV2Repository;
      persistenceV2?: PersistenceV2Service;
      compileService?: ExtractorV14CompileService;
    },
  ) {
    this.runRpc = deps?.runRpc ?? new ExtractionRunRpcRepository(db);
    this.runsV2Repo = deps?.runsV2Repo ?? new ExtractionRunsV2Repository(db);
    this.persistenceV2 = deps?.persistenceV2 ?? new PersistenceV2Service(db);
    this.compileService = deps?.compileService ?? new ExtractorV14CompileService(db, extractV14);
  }

  async run(inboxItem: InboxItem): Promise<{
    inbox_item_id: string;
    processing_status: 'completed' | 'failed';
    extraction_run_id?: string;
    extractor_version?: string | null;
    needs_clarification?: boolean;
  }> {
    const env = loadEnv();
    let runId: string | null = null;

    try {
      const effectiveInput = await this.compileService.buildEffectiveInput(inboxItem);
      const inputContentHash = hashContentForShadow(effectiveInput);

      const start = await this.runRpc.startExtractionRun({
        inboxItemId: inboxItem.id,
        triggerType: 'initial',
        schemaVersion: EXTRACTOR_V14_SCHEMA_VERSION,
        promptVersion: EXTRACTOR_V14_PROMPT_VERSION,
        extractorVersion: EXTRACTOR_V14_VERSION,
        modelName: env.OPENAI_MODEL,
        inputContentHash,
      });
      runId = start.run_id;

      log('info', 'inbox_flow_v14', {
        step: 'extraction_run_started',
        inbox_item_id: inboxItem.id,
        run_id: runId,
      });

      const compiledResult = await this.compileService.compileFromInbox(inboxItem);
      const {
        output,
        compiled,
        clarificationMateriality,
        finalDecision,
        resolverResult,
        taskSignalResolutions,
      } = compiledResult;

      await this.runsV2Repo.saveRawOutput(runId, JSON.stringify(output), output);
      await this.runsV2Repo.saveCompiledOutput(
        runId,
        compiled,
        finalDecision as unknown as Record<string, unknown>,
      );

      if (compiled.decision.status === 'rejected') {
        await this.runRpc.failExtractionRun(
          runId,
          `compiler_rejected: ${compiled.decision.reasons.join('; ')}`,
        );
        return {
          inbox_item_id: inboxItem.id,
          processing_status: 'failed',
          extraction_run_id: runId,
          extractor_version: EXTRACTOR_V14_VERSION,
        };
      }

      await this.persistenceV2.persistCandidates({
        inboxItemId: inboxItem.id,
        extractionRunId: runId,
        compiled,
        clarifications: clarificationMateriality,
        resolverResult,
        taskSignalResolutions,
        contextResolutionEvidence: compiled.contextResolutionEvidence,
      });

      await this.runsV2Repo.markValidated(runId);
      await this.runRpc.promoteExtractionRun(runId);

      log('info', 'inbox_flow_v14', {
        step: 'extraction_run_promoted',
        inbox_item_id: inboxItem.id,
        run_id: runId,
        needs_clarification: finalDecision.status === 'needs_clarification',
      });

      return {
        inbox_item_id: inboxItem.id,
        processing_status: 'completed',
        extraction_run_id: runId,
        extractor_version: EXTRACTOR_V14_VERSION,
        needs_clarification: finalDecision.status === 'needs_clarification',
      };
    } catch (err) {
      if (runId) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          await this.runRpc.failExtractionRun(runId, message);
        } catch (failErr) {
          log('error', 'inbox_flow_v14', {
            step: 'fail_extraction_run_error',
            inbox_item_id: inboxItem.id,
            run_id: runId,
            error: failErr instanceof Error ? failErr.message : String(failErr),
          });
        }
      }
      throw err;
    }
  }
}
