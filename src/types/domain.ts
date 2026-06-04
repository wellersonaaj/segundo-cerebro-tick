export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type SourceMode = 'conversational' | 'passive';
export type ArtifactRecordStatus = 'candidate' | 'active' | 'superseded';
export type RegistryStatus = 'candidate' | 'active' | 'superseded';
export type ExtractionRunStatus = 'started' | 'validated' | 'promoted' | 'failed' | 'discarded';
export type ExtractionTriggerType = 'initial' | 'correction' | 'reprocess';
export type InboxItemEntityRelationType = 'mentioned' | 'subject' | 'author' | 'recipient';

export type EntityType =
  | 'person'
  | 'company'
  | 'project'
  | 'product'
  | 'topic'
  | 'document'
  | 'location'
  | 'other';

export type AssertionType =
  | 'fact'
  | 'hypothesis'
  | 'opinion'
  | 'decision'
  | 'commitment'
  | 'question'
  | 'assumption'
  | 'recommendation';

export type AssertionStatus =
  | 'unverified'
  | 'supported'
  | 'confirmed'
  | 'contested'
  | 'invalidated'
  | 'superseded';

export type TaskStatus = 'open' | 'done' | 'cancelled';

export type ClarificationStatus =
  | 'pending'
  | 'answered'
  | 'dismissed'
  | 'resolved_automatically';

export type ResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous_multiple_matches';

export interface InboxItem {
  id: string;
  raw_content: string;
  source_channel: string;
  source_mode: SourceMode;
  received_at: string;
  timezone: string;
  processing_status: ProcessingStatus;
  extractor_version: string | null;
  processing_error: string | null;
  processed_at: string | null;
  active_extraction_run_id: string | null;
  latest_extraction_run_id: string | null;
  created_at: string;
  source_reference?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ExtractionRun {
  id: string;
  inbox_item_id: string;
  correction_id: string | null;
  trigger_type: ExtractionTriggerType;
  status: ExtractionRunStatus;
  schema_version: string;
  prompt_version: string;
  extractor_version: string;
  model_name: string;
  input_content_hash: string | null;
  raw_model_output: string | null;
  parsed_output: Record<string, unknown> | null;
  validation_errors: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface InboxItemEntity {
  id: string;
  inbox_item_id: string;
  extraction_run_id: string;
  entity_id: string;
  relation_type: InboxItemEntityRelationType;
  source_excerpt: string;
  confidence: number | null;
  record_status: ArtifactRecordStatus;
  correction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityAliasEvidence {
  id: string;
  entity_alias_id: string;
  inbox_item_id: string;
  extraction_run_id: string;
  source_excerpt: string;
  confidence: number | null;
  record_status: ArtifactRecordStatus;
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  entity_type: EntityType;
  normalized_name: string;
  status: string;
  registry_status: RegistryStatus;
  created_by_extraction_run_id: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityAlias {
  id: string;
  entity_id: string;
  alias: string;
  normalized_alias: string;
  registry_status: RegistryStatus;
  created_by_extraction_run_id: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  inbox_item_id: string;
  extraction_run_id: string | null;
  event_type: string;
  description: string;
  occurred_at: string | null;
  source_excerpt: string;
  confidence: number | null;
  status: string;
  record_status: ArtifactRecordStatus;
  superseded_by: string | null;
  correction_id: string | null;
  created_at: string;
}

export interface Assertion {
  id: string;
  inbox_item_id: string;
  extraction_run_id: string | null;
  assertion_type: AssertionType;
  content: string;
  status: AssertionStatus;
  source_excerpt: string;
  confidence: number | null;
  record_status: ArtifactRecordStatus;
  superseded_by: string | null;
  correction_id: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  inbox_item_id: string;
  extraction_run_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  temporal_reference_text: string | null;
  source_excerpt: string;
  is_commitment: boolean;
  status: TaskStatus;
  record_status: ArtifactRecordStatus;
  confidence: number | null;
  superseded_by: string | null;
  correction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClarificationRequest {
  id: string;
  inbox_item_id: string;
  extraction_run_id: string | null;
  target_type: string;
  target_reference: string;
  issue_type: string;
  question: string;
  reason: string;
  priority: string;
  blocking_scope: string;
  suggested_answers: string[];
  source_excerpt: string;
  status: ClarificationStatus;
  record_status: ArtifactRecordStatus;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityResolutionLog {
  id: string;
  inbox_item_id: string;
  extraction_run_id: string | null;
  extracted_entity_name: string;
  resolution_status: ResolutionStatus;
  resolved_entity_id: string | null;
  resolution_method: string | null;
  confidence: number | null;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface Correction {
  id: string;
  inbox_item_id: string;
  correction_text: string;
  created_at: string;
}

export type ClarificationIssueType =
  | 'ambiguous_entity_type'
  | 'ambiguous_entity_identity'
  | 'ambiguous_alias_conflict'
  | 'missing_task_target'
  | 'missing_external_action_target'
  | 'missing_date'
  | 'missing_context'
  | 'other';

export interface ExtractedEntity {
  name: string;
  entity_type: EntityType;
  aliases: string[];
  source_excerpt: string;
  confidence: number;
}

export interface ExtractedEvent {
  event_type: string;
  description: string;
  occurred_at: string | null;
  source_excerpt: string;
  confidence: number;
  entity_names?: string[];
}

export interface ExtractedAssertion {
  assertion_type: AssertionType;
  content: string;
  status: AssertionStatus;
  source_excerpt: string;
  confidence: number;
}

export interface ExtractedTask {
  title: string;
  description: string | null;
  due_at: string | null;
  temporal_reference_text: string | null;
  source_excerpt: string;
  confidence: number;
  is_commitment?: boolean;
}

export interface ExtractedClarification {
  target_type: string;
  target_reference: string;
  issue_type: ClarificationIssueType;
  question: string;
  reason: string;
  priority: string;
  blocking_scope: string;
  suggested_answers: string[];
  source_excerpt: string;
}

export interface ExtractorOutput {
  schema_version: string;
  inbox_item_id: string;
  events: ExtractedEvent[];
  entities: ExtractedEntity[];
  assertions: ExtractedAssertion[];
  tasks: ExtractedTask[];
  clarification_requests: ExtractedClarification[];
  requires_review: boolean;
  review_reasons: string[];
  processing_notes: string[];
}

export interface EntityResolutionResult {
  extractedName: string;
  status: ResolutionStatus;
  resolvedEntityId: string | null;
  resolvedEntityName: string | null;
  method: string | null;
  confidence: number;
  evidence: Record<string, unknown>;
  candidates: Array<{ entity_id: string; name: string; match_type: string }>;
}

export interface ProcessInboxResult {
  inbox_item_id: string;
  extraction_run_id: string;
  processing_status: ProcessingStatus;
  has_active_memory: boolean;
  extractor_version: string;
  entities_created: number;
  entities_resolved: number;
  events_created: number;
  assertions_created: number;
  tasks_created: number;
  clarifications_pending: number;
  clarifications_resolved_automatically: number;
  requires_review: boolean;
  review_reasons: string[];
  processing_notes: string[];
}
