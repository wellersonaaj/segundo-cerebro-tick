import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpenTaskRow } from './rag/rag.types.js';

export class OpenTasksService {
  constructor(private readonly db: SupabaseClient) {}

  async listOpen(limit = 20): Promise<OpenTaskRow[]> {
    const { data, error } = await this.db
      .from('tasks')
      .select('id,title,due_at_local_date,due_at_local_time,status,source_excerpt')
      .eq('status', 'open')
      .order('due_at_local_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`tasks list: ${error.message}`);
    return (data ?? []) as OpenTaskRow[];
  }
}
