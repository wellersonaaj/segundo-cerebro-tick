import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractionTriggerType } from '../../types/domain.js';

export interface StartExtractionRunV2Params {
  inboxItemId: string;
  triggerType: ExtractionTriggerType;
  schemaVersion: string;
  promptVersion: string;
  extractorVersion: string;
  modelName: string;
  normalizerVersion: string;
  compilerVersion: string;
  correctionId?: string | null;
  inputContentHash?: string | null;
}

export interface StartExtractionRunV2Result {
  run_id: string;
  inbox_item_id: string;
}

export class ExtractionRunRpcV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async startExtractionRun(params: StartExtractionRunV2Params): Promise<StartExtractionRunV2Result> {
    const { data, error } = await this.db.rpc('start_extraction_run', {
      p_inbox_item_id: params.inboxItemId,
      p_trigger_type: params.triggerType,
      p_schema_version: params.schemaVersion,
      p_prompt_version: params.promptVersion,
      p_extractor_version: params.extractorVersion,
      p_model_name: params.modelName,
      p_normalizer_version: params.normalizerVersion,
      p_compiler_version: params.compilerVersion,
      p_correction_id: params.correctionId ?? null,
      p_input_content_hash: params.inputContentHash ?? null,
    });
    if (error) throw new Error(`start_extraction_run: ${error.message}`);
    return data as StartExtractionRunV2Result;
  }

  async promoteExtractionRun(runId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc('promote_extraction_run', { p_run_id: runId });
    if (error) throw new Error(`promote_extraction_run: ${error.message}`);
    return data as Record<string, unknown>;
  }

  async failExtractionRun(runId: string, errorMessage: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc('fail_extraction_run', {
      p_run_id: runId,
      p_error: errorMessage,
    });
    if (error) throw new Error(`fail_extraction_run: ${error.message}`);
    return data as Record<string, unknown>;
  }
}
