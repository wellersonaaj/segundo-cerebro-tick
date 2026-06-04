import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractionRun, ExtractorOutput } from '../types/domain.js';

export class ExtractionRunsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findById(id: string): Promise<ExtractionRun | null> {
    const { data, error } = await this.db
      .from('inbox_extraction_runs')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`extraction_runs.findById: ${error.message}`);
    return data as ExtractionRun | null;
  }

  async listByInboxItem(inboxItemId: string): Promise<ExtractionRun[]> {
    const { data, error } = await this.db
      .from('inbox_extraction_runs')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`extraction_runs.listByInboxItem: ${error.message}`);
    return (data ?? []) as ExtractionRun[];
  }

  async inboxIdsWithCorrectionRuns(inboxItemIds: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!inboxItemIds.length) return ids;

    const { data, error } = await this.db
      .from('inbox_extraction_runs')
      .select('inbox_item_id')
      .in('inbox_item_id', inboxItemIds)
      .eq('trigger_type', 'correction');
    if (error) throw new Error(`extraction_runs.inboxIdsWithCorrectionRuns: ${error.message}`);
    for (const row of data ?? []) {
      ids.add(row.inbox_item_id as string);
    }
    return ids;
  }

  async saveRawOutput(runId: string, rawModelOutput: string, parsedOutput: ExtractorOutput): Promise<void> {
    const { error } = await this.db
      .from('inbox_extraction_runs')
      .update({
        raw_model_output: rawModelOutput,
        parsed_output: parsedOutput as unknown as Record<string, unknown>,
      })
      .eq('id', runId);
    if (error) throw new Error(`extraction_runs.saveRawOutput: ${error.message}`);
  }

  async markValidated(runId: string): Promise<void> {
    const { error } = await this.db
      .from('inbox_extraction_runs')
      .update({ status: 'validated', finished_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', 'started');
    if (error) throw new Error(`extraction_runs.markValidated: ${error.message}`);
  }
}
