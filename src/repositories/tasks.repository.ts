import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIlikeOrFilter } from '../db/postgrest-filter-utils.js';
import type { ExtractedTask, Task, TaskStatus } from '../types/domain.js';

function mapTaskRow(row: Record<string, unknown>): Task {
  const localDate = row.due_at_local_date as string | null | undefined;
  const instant = row.due_at_instant as string | null | undefined;
  const legacyDue = row.due_at as string | null | undefined;
  const dueAt =
    legacyDue ??
    instant ??
    (localDate ? `${String(localDate).slice(0, 10)}T00:00:00.000Z` : null);

  return {
    id: row.id as string,
    inbox_item_id: (row.inbox_item_id as string) ?? '',
    extraction_run_id: (row.extraction_run_id as string | null) ?? null,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    due_at: dueAt,
    temporal_reference_text:
      (row.temporal_reference_text as string | null) ??
      (row.due_at_literal as string | null) ??
      null,
    source_excerpt: (row.source_excerpt as string | null) ?? '',
    is_commitment: (row.is_commitment as boolean) ?? false,
    status: row.status as TaskStatus,
    record_status: row.record_status as Task['record_status'],
    confidence: (row.confidence as number | null) ?? null,
    superseded_by: (row.superseded_by as string | null) ?? null,
    correction_id: (row.correction_id as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? row.created_at as string,
  };
}

export class TasksRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    inboxItemId: string,
    extracted: ExtractedTask,
    dueAt: string | null,
    correctionId?: string,
  ): Promise<Task> {
    return this.createCandidate(inboxItemId, null, extracted, dueAt, correctionId);
  }

  async createCandidate(
    inboxItemId: string,
    extractionRunId: string | null,
    extracted: ExtractedTask,
    dueAt: string | null,
    correctionId?: string,
  ): Promise<Task> {
    const { data, error } = await this.db
      .from('tasks')
      .insert({
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        title: extracted.title,
        description: extracted.description,
        due_at: dueAt,
        temporal_reference_text: extracted.temporal_reference_text,
        source_excerpt: extracted.source_excerpt,
        is_commitment: extracted.is_commitment ?? false,
        confidence: extracted.confidence,
        correction_id: correctionId ?? null,
        record_status: 'candidate',
        status: 'open',
      })
      .select()
      .single();
    if (error) throw new Error(`tasks.createCandidate: ${error.message}`);
    return data as Task;
  }

  async list(status?: TaskStatus, query?: string, limit = 50): Promise<Task[]> {
    let q = this.db
      .from('tasks')
      .select()
      .order('due_at_local_date', { ascending: true, nullsFirst: false });
    if (status) q = q.eq('status', status);
    else q = q.neq('status', 'cancelled');
    if (query) {
      q = q.or(buildIlikeOrFilter(['title', 'source_excerpt'], query));
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(`tasks.list: ${error.message}`);
    const tasks = (data ?? []).map((row) => mapTaskRow(row as Record<string, unknown>));
    return this.enrichTaskLineage(tasks);
  }

  /** Greenfield projection: tasks table has no inbox_item_id; join active task_mutations. */
  private async enrichTaskLineage(tasks: Task[]): Promise<Task[]> {
    const needsLineage = tasks.filter((t) => !t.inbox_item_id);
    if (needsLineage.length === 0) return tasks;

    const ids = needsLineage.map((t) => t.id);
    const { data: mutations, error } = await this.db
      .from('task_mutations')
      .select('task_id, inbox_item_id, extraction_run_id, created_at')
      .in('task_id', ids)
      .eq('record_status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`tasks.enrichTaskLineage: ${error.message}`);

    const lineage = new Map<string, { inbox_item_id: string; extraction_run_id: string }>();
    for (const row of mutations ?? []) {
      const taskId = row.task_id as string;
      if (!taskId || lineage.has(taskId)) continue;
      lineage.set(taskId, {
        inbox_item_id: row.inbox_item_id as string,
        extraction_run_id: row.extraction_run_id as string,
      });
    }

    return tasks.map((t) => {
      const meta = lineage.get(t.id);
      if (!meta) return t;
      return {
        ...t,
        inbox_item_id: t.inbox_item_id || meta.inbox_item_id,
        extraction_run_id: t.extraction_run_id ?? meta.extraction_run_id,
      };
    });
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
