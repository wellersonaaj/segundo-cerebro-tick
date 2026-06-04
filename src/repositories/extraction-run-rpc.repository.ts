import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractionTriggerType } from '../types/domain.js';
import { TEMPORAL_NORMALIZER_VERSION } from '../types/temporal-normalization.js';
import { MEMORY_COMPILER_V2_VERSION } from '../types/memory-compiler-v2.js';

export interface StartExtractionRunParams {
  inboxItemId: string;
  triggerType: ExtractionTriggerType;
  schemaVersion: string;
  promptVersion: string;
  extractorVersion: string;
  modelName: string;
  correctionId?: string | null;
  inputContentHash?: string | null;
  normalizerVersion?: string;
  compilerVersion?: string;
}

export interface StartExtractionRunResult {
  run_id: string;
  inbox_item_id: string;
}

export interface PromoteExtractionRunResult {
  inbox_item_id: string;
  run_id: string;
  has_active_memory: boolean;
}

export interface FailExtractionRunResult {
  inbox_item_id: string;
  run_id: string;
  processing_status: string | null;
  has_active_memory: boolean;
  stale_run: boolean;
}

export class ExtractionRunRpcRepository {
  constructor(private readonly db: SupabaseClient) {}

  async startExtractionRun(params: StartExtractionRunParams): Promise<StartExtractionRunResult> {
    const { data, error } = await this.db.rpc('start_extraction_run', {
      p_inbox_item_id: params.inboxItemId,
      p_trigger_type: params.triggerType,
      p_schema_version: params.schemaVersion,
      p_prompt_version: params.promptVersion,
      p_extractor_version: params.extractorVersion,
      p_model_name: params.modelName,
      p_normalizer_version: params.normalizerVersion ?? TEMPORAL_NORMALIZER_VERSION,
      p_compiler_version: params.compilerVersion ?? MEMORY_COMPILER_V2_VERSION,
      p_correction_id: params.correctionId ?? null,
      p_input_content_hash: params.inputContentHash ?? null,
    });
    if (error) throw new Error(`start_extraction_run: ${error.message}`);
    return data as StartExtractionRunResult;
  }

  async promoteExtractionRun(runId: string): Promise<PromoteExtractionRunResult> {
    const { data, error } = await this.db.rpc('promote_extraction_run', {
      p_run_id: runId,
    });
    if (error) throw new Error(`promote_extraction_run: ${error.message}`);
    return data as PromoteExtractionRunResult;
  }

  async failExtractionRun(runId: string, errorMessage: string): Promise<FailExtractionRunResult> {
    const { data, error } = await this.db.rpc('fail_extraction_run', {
      p_run_id: runId,
      p_error: errorMessage,
    });
    if (error) throw new Error(`fail_extraction_run: ${error.message}`);
    return data as FailExtractionRunResult;
  }
}
