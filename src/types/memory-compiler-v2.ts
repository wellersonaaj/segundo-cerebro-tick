import type { ExtractorOutputV14, TaskOperation } from '../openai/extractor-v1.4.types.js';
import type {
  CompactIngestionContext,
  ContextResolutionEvidence,
  IngestionContext,
  TaskSignalContextResolution,
} from './ingestion-context.js';
import type { MemoryResolverResult } from '../services/reference-resolver.service.js';
import type { NormalizedTemporalValue } from './temporal-normalization.js';
import type { ExternalKnowledgeEnrichmentResult } from './external-knowledge-enrichment.js';

export interface TemporalAnchor {
  receivedAt: string;
  timezone?: string | null;
}

export const MEMORY_COMPILER_V2_VERSION = 'memory-compiler-v2';

export type DroppedArtifactKindV2 =
  | 'entity_mention'
  | 'event'
  | 'assertion'
  | 'task'
  | 'clarification'
  | 'alias';

export type DroppedArtifactReasonV2 =
  | 'weak_reference'
  | 'alias_not_entity'
  | 'episodic_gate'
  | 'static_or_panorama'
  | 'correction_superseded'
  | 'invalid_source_block'
  | 'status_update_missing_value'
  | 'generic_term_isolated'
  | 'negated_reference'
  | 'non_registry_entity_type';

export interface DroppedArtifactV2 {
  kind: DroppedArtifactKindV2;
  reason: DroppedArtifactReasonV2;
  originalRef: string;
  sourceExcerpt: string;
  note?: string;
}

export interface CompiledEntityReference {
  mentionText: string;
  suggestedEntityType: string;
  entityId: string | null;
  canonicalName: string | null;
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved';
  sourceExcerpt: string;
  confidence: number;
}

export interface CompiledAliasV2 {
  alias: string;
  targetReference: string;
  targetEntityId: string | null;
  targetCanonicalName: string | null;
  negatedFormerReferences: string[];
  sourceExcerpt: string;
  confidence: number;
  sourceBlockReference: string | null;
}

export interface CompiledEventEntityLink {
  entityReference: string;
  entityId: string | null;
  canonicalName: string | null;
  relationType: string;
  role: string | null;
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved';
}

export interface CompiledEventV2 {
  eventKind: string;
  title: string;
  occurredAt: string | null;
  episodicConfidence: number;
  sourceExcerpt: string;
  confidence: number;
  relatedEntities: CompiledEventEntityLink[];
  sourceBlockReference: string | null;
}

export interface CompiledAssertionV2 {
  assertionKind: string;
  subjectReference: string;
  predicate: string;
  objectReference: string | null;
  valueText: string | null;
  relatedEntityReferences: string[];
  sourceExcerpt: string;
  sourceBlockReference: string | null;
  confidence: number;
  subjectEntityId: string | null;
}

export interface CompiledTaskV2 {
  operation: TaskOperation;
  taskReference: string | null;
  title: string;
  taskKind: string;
  statusSignal: string;
  assigneeReference: string | null;
  targetReference: string | null;
  projectReference: string | null;
  assigneeEntityId: string | null;
  projectEntityId: string | null;
  dueAt: string | null;
  dueAtTemporal: NormalizedTemporalValue | null;
  blockedReason: string | null;
  sourceExcerpt: string;
  sourceBlockReference: string | null;
  confidence: number;
}

export interface CompiledClarificationCandidateV2 {
  targetType: string;
  targetReference: string;
  issueType: string;
  question: string;
  reason: string;
  priority: string;
  blockingScope: string;
  suggestedAnswers: string[];
  sourceExcerpt: string;
  source: 'llm' | 'resolver' | 'compiler';
}

export interface CompiledReviewHintV2 {
  issueType: string;
  targetReference: string | null;
  reason: string;
  sourceExcerpt: string;
  confidence: number;
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

export interface CompilerFlagsV2 {
  negatedReferences: string[];
  supersededReferences: string[];
  presentSourceBlocks: string[];
  contextResolvedTasks: string[];
  contextAmbiguousTasks: string[];
}

export interface CompiledMemoryV2 {
  compilerVersion: typeof MEMORY_COMPILER_V2_VERSION;
  resolvedEntities: CompiledEntityReference[];
  aliases: CompiledAliasV2[];
  events: CompiledEventV2[];
  assertions: CompiledAssertionV2[];
  tasks: CompiledTaskV2[];
  clarificationCandidates: CompiledClarificationCandidateV2[];
  reviewHints: CompiledReviewHintV2[];
  droppedArtifacts: DroppedArtifactV2[];
  compilerNotes: string[];
  decision: CompilerDecision;
  flags: CompilerFlagsV2;
  taskSignalResolutions: TaskSignalContextResolution[];
  contextResolutionEvidence: ContextResolutionEvidence[];
  enrichmentEvidence?: ExternalKnowledgeEnrichmentResult;
}

export interface AnsweredClarificationForCompile {
  question: string;
  answer: string;
  issue_type: string;
  target_reference: string;
}

export interface MemoryCompilerV2Input {
  extractorOutput: ExtractorOutputV14;
  effectiveInput: string;
  resolverResult: MemoryResolverResult;
  fullIngestionContext?: IngestionContext;
  compactIngestionContext?: CompactIngestionContext;
  taskSignalResolutions?: TaskSignalContextResolution[];
  temporalAnchor?: TemporalAnchor;
  externalEnrichment?: ExternalKnowledgeEnrichmentResult;
  enrichmentAutoApplyConfidence?: number;
  enrichmentSuggestConfidence?: number;
  answeredClarifications?: AnsweredClarificationForCompile[];
}
