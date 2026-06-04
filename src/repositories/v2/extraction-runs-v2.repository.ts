import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractorOutputV14 } from '../../openai/extractor-v1.4.types.js';
import type { CompiledMemoryV2 } from '../../types/memory-compiler-v2.js';
import type { ExtractionRunV2 } from '../../types/domain-v2.js';

export class ExtractionRunsV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async findById(id: string): Promise<ExtractionRunV2 | null> {
    const { data, error } = await this.db
      .from('inbox_extraction_runs')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`extraction_runs_v2.findById: ${error.message}`);
    return data as ExtractionRunV2 | null;
  }

  async saveRawOutput(
    runId: string,
    rawModelOutput: string,
    parsedOutput: ExtractorOutputV14,
  ): Promise<void> {
    const { error } = await this.db
      .from('inbox_extraction_runs')
      .update({
        raw_model_output: rawModelOutput,
        parsed_output: parsedOutput as unknown as Record<string, unknown>,
      })
      .eq('id', runId);
    if (error) throw new Error(`extraction_runs_v2.saveRawOutput: ${error.message}`);
  }

  async saveCompiledOutput(
    runId: string,
    compiled: CompiledMemoryV2,
    finalDecision?: Record<string, unknown>,
  ): Promise<void> {
    const payload = {
      ...compiled,
      finalDecision: finalDecision ?? null,
    };
    const { error } = await this.db
      .from('inbox_extraction_runs')
      .update({
        compiled_output: payload as unknown as Record<string, unknown>,
      })
      .eq('id', runId);
    if (error) throw new Error(`extraction_runs_v2.saveCompiledOutput: ${error.message}`);
  }

  async markValidated(runId: string): Promise<void> {
    const { error } = await this.db
      .from('inbox_extraction_runs')
      .update({ status: 'validated', finished_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', 'started');
    if (error) throw new Error(`extraction_runs_v2.markValidated: ${error.message}`);
  }
}
