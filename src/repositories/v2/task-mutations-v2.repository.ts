import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompiledTaskV2 } from '../../types/memory-compiler-v2.js';
import type { ContextResolutionEvidence } from '../../types/ingestion-context.js';
import { dueAtColumnsFromTemporal } from '../../types/domain-v2.js';

export class TaskMutationsV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(
    inboxItemId: string,
    extractionRunId: string,
    task: CompiledTaskV2,
    opts: {
      taskId?: string | null;
      assigneeEntityId?: string | null;
      projectEntityId?: string | null;
      contextResolutionEvidence?: ContextResolutionEvidence | null;
      correctionId?: string;
    },
  ): Promise<{ id: string; task_id: string | null }> {
    const due = dueAtColumnsFromTemporal(task.dueAtTemporal, task.dueAt);
    const taskId = task.operation === 'create' ? null : (opts.taskId ?? null);

    const { data, error } = await this.db
      .from('task_mutations')
      .insert({
        task_id: taskId,
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        operation: task.operation,
        task_reference: task.taskReference,
        title: task.title,
        task_kind: task.taskKind,
        status_signal: task.statusSignal,
        assignee_entity_id: opts.assigneeEntityId ?? task.assigneeEntityId,
        project_entity_id: opts.projectEntityId ?? task.projectEntityId,
        blocked_reason: task.blockedReason,
        source_excerpt: task.sourceExcerpt,
        source_block_reference: task.sourceBlockReference,
        confidence: task.confidence,
        context_resolution_evidence: opts.contextResolutionEvidence ?? null,
        correction_id: opts.correctionId ?? null,
        record_status: 'candidate',
        ...due,
      })
      .select('id, task_id')
      .single();
    if (error) throw new Error(`task_mutations_v2.createCandidate: ${error.message}`);
    return data as { id: string; task_id: string | null };
  }
}
