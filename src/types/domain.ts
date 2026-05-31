export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type SourceMode = 'conversational' | 'passive';

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

export type TaskStatus = 'open' | 'done' | 'cancelled' | 'superseded';

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
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  entity_type: EntityType;
  normalized_name: string;
  status: string;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityAlias {
  id: string;
  entity_id: string;
  alias: string;
  normalized_alias: string;
  created_at: string;
}

export interface Event {
  id: string;
  inbox_item_id: string;
  event_type: string;
  description: string;
  occurred_at: string | null;
  source_excerpt: string;
  confidence: number | null;
  status: string;
  superseded_by: string | null;
  correction_id: string | null;
  created_at: string;
}

export interface Assertion {
  id: string;
  inbox_item_id: string;
  assertion_type: AssertionType;
  content: string;
  status: AssertionStatus;
  source_excerpt: string;
  confidence: number | null;
  record_status: string;
  superseded_by: string | null;
  correction_id: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  inbox_item_id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  temporal_reference_text: string | null;
  source_excerpt: string;
  is_commitment: boolean;
  status: TaskStatus;
  confidence: number | null;
  superseded_by: string | null;
  correction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClarificationRequest {
  id: string;
  inbox_item_id: string;
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
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityResolutionLog {
  id: string;
  inbox_item_id: string;
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

export interface ExtractedEntity {
  name: string;
  entity_type: EntityType;
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
  issue_type: string;
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
  processing_status: ProcessingStatus;
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
