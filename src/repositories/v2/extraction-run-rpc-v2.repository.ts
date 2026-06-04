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

export interface PersistExtractionCandidatesV2Input {
  inboxItemId: string;
  extractionRunId: string;
  correctionId?: string | null;
  entities: Array<{
    name: string;
    entity_type: string;
    normalized_name: string;
  }>;
  inboxItemEntities: Array<{
    entity_name: string;
    relation_type: string;
    source_excerpt: string;
    source_block_ref?: string | null;
    confidence?: number | null;
  }>;
  aliases: Array<{
    target_entity_name: string;
    alias: string;
    source_excerpt: string;
    source_block_ref?: string | null;
    confidence?: number | null;
  }>;
  events: Array<{
    event_kind: string;
    title: string;
    occurred_at?: string | null;
    episodic_confidence?: number | null;
    source_excerpt: string;
    source_block_ref?: string | null;
    confidence?: number | null;
    related_entities: Array<{
      entity_name: string;
      relation_type: string;
      role?: string | null;
      resolution_status: string;
    }>;
  }>;
  assertions: Array<{
    assertion_kind: string;
    subject_ref: string;
    subject_entity_name?: string | null;
    predicate: string;
    object_ref?: string | null;
    value_text?: string | null;
    source_excerpt: string;
    source_block_ref?: string | null;
    confidence?: number | null;
    related_entity_refs: string[];
  }>;
  taskMutations: Array<{
    operation: string;
    task_ref?: string | null;
    title?: string | null;
    task_kind?: string | null;
    status_signal?: string | null;
    assignee_entity_name?: string | null;
    project_entity_name?: string | null;
    blocked_reason?: string | null;
    source_excerpt: string;
    source_block_ref?: string | null;
    confidence?: number | null;
    task_id?: string | null;
    context_resolution_evidence?: Record<string, unknown> | null;
    due_at_literal?: string | null;
    due_at_local_date?: string | null;
    due_at_local_time?: string | null;
    due_at_instant?: string | null;
    due_at_timezone?: string | null;
    due_at_precision?: string | null;
    due_at_status?: string | null;
    due_at_reason_code?: string | null;
    due_at_normalizer_version?: string | null;
    due_at_implicit_year?: boolean | null;
    due_at_implicit_month?: boolean | null;
  }>;
  clarifications: Array<{
    target_type: string;
    target_reference: string;
    issue_type: string;
    question: string;
    reason: string;
    priority: string;
    blocking_scope: string;
    materiality: string;
    suggested_answers: string[];
    source_excerpt: string;
    source: string;
  }>;
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

  async persistCandidates(
    input: PersistExtractionCandidatesV2Input,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc('persist_extraction_candidates', {
      p_inbox_item_id: input.inboxItemId,
      p_extraction_run_id: input.extractionRunId,
      p_correction_id: input.correctionId ?? null,
      p_entities: input.entities,
      p_inbox_item_entities: input.inboxItemEntities,
      p_aliases: input.aliases,
      p_events: input.events,
      p_assertions: input.assertions,
      p_task_mutations: input.taskMutations,
      p_clarifications: input.clarifications,
    });
    if (error) throw new Error(`persist_extraction_candidates RPC: ${error.message}`);
    return data as Record<string, unknown>;
  }
}
