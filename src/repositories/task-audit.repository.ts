import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditTaskRow {
  id: string;
  inbox_item_id: string;
  title: string;
  description: string | null;
  status: string;
  task_kind: string | null;
  due_at: string | null;
  target: string | null;
  source_excerpt: string | null;
}

function resolveDueAt(row: Record<string, unknown>): string | null {
  const instant = row.due_at_instant as string | null | undefined;
  if (instant) return instant;
  const localDate = row.due_at_local_date as string | null | undefined;
  if (localDate) return `${String(localDate).slice(0, 10)}T00:00:00.000Z`;
  return null;
}

export class TaskAuditRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listByInboxItem(inboxItemId: string): Promise<AuditTaskRow[]> {
    const { data: mutations, error: mutErr } = await this.db
      .from('task_mutations')
      .select('task_id, task_reference, title, inbox_item_id')
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active')
      .order('created_at', { ascending: true });
    if (mutErr) throw new Error(`task_audit.listByInboxItem.mutations: ${mutErr.message}`);

    const mutationRows = mutations ?? [];
    const taskIds = [
      ...new Set(
        mutationRows
          .map((row) => row.task_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const tasksById = new Map<string, Record<string, unknown>>();
    if (taskIds.length) {
      const { data: tasks, error: taskErr } = await this.db
        .from('tasks')
        .select(
          'id, title, status, task_kind, due_at_instant, due_at_local_date, source_excerpt, assignee_entity_id',
        )
        .in('id', taskIds);
      if (taskErr) throw new Error(`task_audit.listByInboxItem.tasks: ${taskErr.message}`);
      for (const row of tasks ?? []) {
        tasksById.set(row.id as string, row as Record<string, unknown>);
      }
    }

    const entityIds = [
      ...new Set(
        [...tasksById.values()]
          .map((row) => row.assignee_entity_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const entityNames = await this.loadEntityNames(entityIds);

    const seenTaskIds = new Set<string>();
    const results: AuditTaskRow[] = [];

    for (const mutation of mutationRows) {
      const taskId = mutation.task_id as string | null;
      const mutationTitle = (mutation.title as string | null) ?? null;
      const mutationReference = (mutation.task_reference as string | null) ?? null;

      if (taskId && seenTaskIds.has(taskId)) continue;
      if (taskId) seenTaskIds.add(taskId);

      const taskRow = taskId ? tasksById.get(taskId) : undefined;
      const assigneeId = taskRow?.assignee_entity_id as string | null | undefined;
      const target =
        (assigneeId ? entityNames.get(assigneeId) : null) ??
        mutationReference ??
        null;

      results.push({
        id: taskId ?? `mutation:${mutation.inbox_item_id}:${results.length}`,
        inbox_item_id: inboxItemId,
        title: (taskRow?.title as string) ?? mutationTitle ?? '(sem título)',
        description: null,
        status: (taskRow?.status as string) ?? 'open',
        task_kind: (taskRow?.task_kind as string | null) ?? null,
        due_at: taskRow ? resolveDueAt(taskRow) : null,
        target,
        source_excerpt: (taskRow?.source_excerpt as string | null) ?? null,
      });
    }

    return results;
  }

  private async loadEntityNames(entityIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (!entityIds.length) return names;

    const { data, error } = await this.db.from('entities').select('id, name').in('id', entityIds);
    if (error) throw new Error(`task_audit.loadEntityNames: ${error.message}`);
    for (const row of data ?? []) {
      names.set(row.id as string, row.name as string);
    }
    return names;
  }
}
