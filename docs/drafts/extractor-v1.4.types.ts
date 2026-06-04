/**
 * @deprecated Use src/openai/extractor-v1.4.types.ts (productive contract).
 * Kept as draft mirror — see docs/extractor-v1.4-spec.md
 */

export type EntityType =
  | 'person'
  | 'company'
  | 'project'
  | 'product'
  | 'topic'
  | 'document'
  | 'location'
  | 'other';

export interface ExtractedEntityMention {
  mention_text: string;
  suggested_entity_type: EntityType;
  source_excerpt: string;
  confidence: number;
}

export interface ExtractedAlias {
  alias: string;
  target_reference: string;
  negated_former_references: string[];
  source_excerpt: string;
  confidence: number;
}

export type EventKind =
  | 'meeting'
  | 'confirmation'
  | 'decision'
  | 'document_sent'
  | 'presentation'
  | 'commitment'
  | 'change'
  | 'correction'
  | 'other';

export type EventRelationType =
  | 'participant'
  | 'subject'
  | 'mentioned'
  | 'sender'
  | 'recipient'
  | 'other';

export interface ExtractedEventEntityReference {
  entity_reference: string;
  relation_type: EventRelationType;
  role: string | null;
}

export interface ExtractedEvent {
  event_kind: EventKind;
  title: string;
  source_excerpt: string;
  occurred_at: string | null;
  episodic_confidence: number;
  related_entities: ExtractedEventEntityReference[];
}

export type CorrectionType =
  | 'replace_subject'
  | 'replace_object'
  | 'invalidate_assertion'
  | 'invalidate_alias'
  | 'other';

export interface ExtractedCorrectionSignal {
  correction_type: CorrectionType;
  previous_reference: string | null;
  current_reference: string | null;
  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}

export type AssertionKind =
  | 'fact'
  | 'hypothesis'
  | 'opinion'
  | 'decision'
  | 'commitment'
  | 'status_update'
  | 'other';

export interface ExtractedAssertion {
  assertion_kind: AssertionKind;
  subject_reference: string;
  predicate: string;
  object_reference: string | null;
  value_text: string | null;
  related_entity_references: string[];
  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}

export type TaskKind =
  | 'follow_up'
  | 'delivery'
  | 'decision'
  | 'review'
  | 'external_action'
  | 'other';

export type TaskStatusSignal = 'open' | 'completed' | 'cancelled' | 'blocked' | 'unknown';

export interface ExtractedTask {
  title: string;
  task_kind: TaskKind;
  status_signal: TaskStatusSignal;
  assignee_reference: string | null;
  target_reference: string | null;
  project_reference: string | null;
  due_at: string | null;
  blocked_reason: string | null;
  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}

export type ReviewHintIssueType =
  | 'ambiguous_identity'
  | 'ambiguous_entity_type'
  | 'possible_contradiction'
  | 'low_confidence_event'
  | 'unresolved_reference'
  | 'other';

export interface ReviewHint {
  issue_type: ReviewHintIssueType;
  target_reference: string | null;
  reason: string;
  source_excerpt: string;
  confidence: number;
}

export interface ClarificationCandidate {
  target_type: 'entity' | 'event' | 'assertion' | 'task' | 'external_action' | 'other';
  target_reference: string;
  issue_type: string;
  question: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  blocking_scope: 'none' | 'knowledge_confirmation' | 'task_execution' | 'external_action';
  suggested_answers: string[];
  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}

export interface ExtractorOutputV14 {
  schema_version: '1.4';
  entity_mentions: ExtractedEntityMention[];
  aliases: ExtractedAlias[];
  events: ExtractedEvent[];
  correction_signals: ExtractedCorrectionSignal[];
  assertions: ExtractedAssertion[];
  tasks: ExtractedTask[];
  clarification_candidates: ClarificationCandidate[];
  review_hints: ReviewHint[];
  extraction_notes: string[];
}

export type CompilerDecisionStatus =
  | 'accepted'
  | 'rejected'
  | 'needs_clarification'
  | 'needs_llm_review';

export interface CompilerDecision {
  status: CompilerDecisionStatus;
  reasons: string[];
  confidence: number;
}
