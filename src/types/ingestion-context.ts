import type { TaskOperation } from '../openai/extractor-v1.4.types.js';

export interface EntityLikeSourceMetadata {
  sender_reference?: string;
  recipient_references?: string[];
}

export interface RoutingSourceMetadata {
  thread_reference?: string;
  reply_to_reference?: string;
  subject?: string;
  occurred_at?: string;
}

export interface SourceMetadata {
  entityLike: EntityLikeSourceMetadata;
  routing: RoutingSourceMetadata;
}

export interface ProjectContext {
  id: string;
  reference: string;
  normalizedReference: string;
}

export interface TaskContext {
  id: string;
  reference: string;
  normalizedReference: string;
  projectReference?: string | null;
  status?: string;
  assigneeReference?: string | null;
  threadReferences?: string[];
  lastMentionedAt?: string;
}

export interface AliasContext {
  alias: string;
  targetReference: string;
}

export interface EntityContext {
  id: string;
  reference: string;
  normalizedReference: string;
}

export interface AssertionContext {
  id: string;
  subjectReference: string;
  assertionKind: string;
}

export interface EventContext {
  id: string;
  eventKind: string;
  title: string;
}

export interface IngestionContext {
  activeProjects: ProjectContext[];
  openTasks: TaskContext[];
  activeAliases: AliasContext[];
  recentEntities: EntityContext[];
  recentAssertions: AssertionContext[];
  recentEvents: EventContext[];
  sourceMetadata: SourceMetadata;
}

export type CompactIngestionContext = IngestionContext;

export const EMPTY_SOURCE_METADATA: SourceMetadata = {
  entityLike: {},
  routing: {},
};

export const EMPTY_INGESTION_CONTEXT: IngestionContext = {
  activeProjects: [],
  openTasks: [],
  activeAliases: [],
  recentEntities: [],
  recentAssertions: [],
  recentEvents: [],
  sourceMetadata: EMPTY_SOURCE_METADATA,
};

export type ContextResolutionSource =
  | 'explicit_reference'
  | 'context_unique_match'
  | 'thread_affinity'
  | 'subject_affinity';

export type TaskResolutionReason =
  | 'explicit_match'
  | 'score_above_margin'
  | 'score_below_minimum'
  | 'ambiguous_close_scores'
  | 'no_plausible_candidate'
  | 'multiple_before_truncation';

export interface TaskResolutionOutcome {
  status: 'resolved' | 'ambiguous' | 'unresolved';
  taskId?: string;
  canonicalReference?: string;
  candidates?: TaskContext[];
  bestScore: number;
  secondBestScore: number | null;
  scoreMargin: number | null;
  candidateCountBeforeTruncation: number;
  resolutionReason: TaskResolutionReason;
  resolutionSource?: ContextResolutionSource;
}

export interface TaskSignalContextResolution {
  taskSignalIndex: number;
  operation: TaskOperation;
  outcome: TaskResolutionOutcome;
}

export interface ContextResolutionEvidence {
  taskSignalIndex: number;
  taskId: string;
  resolutionSource: ContextResolutionSource;
  bestScore: number;
  secondBestScore: number | null;
  scoreMargin: number | null;
  candidateCountBeforeTruncation: number;
  resolutionReason: TaskResolutionReason;
}

export type CalibrationRegime =
  | 'first_contact'
  | 'incremental_single'
  | 'incremental_ambiguous';
