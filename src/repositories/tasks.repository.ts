import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractedTask, Task, TaskStatus } from '../types/domain.js';

export class TasksRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    inboxItemId: string,
    extracted: ExtractedTask,
    dueAt: string | null,
    correctionId?: string,
  ): Promise<Task> {
    const { data, error } = await this.db
      .from('tasks')
      .insert({
        inbox_item_id: inboxItemId,
        title: extracted.title,
        description: extracted.description,
        due_at: dueAt,
        temporal_reference_text: extracted.temporal_reference_text,
        source_excerpt: extracted.source_excerpt,
        is_commitment: extracted.is_commitment ?? false,
        confidence: extracted.confidence,
        correction_id: correctionId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`tasks.create: ${error.message}`);
    return data as Task;
  }

  async list(status?: TaskStatus, query?: string, limit = 50): Promise<Task[]> {
    let q = this.db.from('tasks').select().order('due_at', { ascending: true, nullsFirst: false });
    if (status) q = q.eq('status', status);
    else q = q.neq('status', 'superseded');
    if (query) q = q.or(`title.ilike.%${query}%,description.ilike.%${query}%,source_excerpt.ilike.%${query}%`);
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(`tasks.list: ${error.message}`);
    return (data ?? []) as Task[];
  }

  async listOpen(query?: string, limit = 50): Promise<Task[]> {
    return this.list('open', query, limit);
  }

  async supersedeByInboxItem(inboxItemId: string, correctionId: string): Promise<void> {
    const { error } = await this.db
      .from('tasks')
      .update({ status: 'superseded', correction_id: correctionId })
      .eq('inbox_item_id', inboxItemId)
      .eq('status', 'open');
    if (error) throw new Error(`tasks.supersede: ${error.message}`);
  }
}
