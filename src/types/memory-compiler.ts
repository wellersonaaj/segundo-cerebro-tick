import type { EntityType, ExtractorOutput } from './domain.js';
import type { ResolvedEntityMap } from '../services/memory-resolver.service.js';

export const MEMORY_COMPILER_VERSION = 'memory-compiler-v1';

export type DroppedArtifactKind =
  | 'entity'
  | 'event'
  | 'assertion'
  | 'task'
  | 'clarification'
  | 'alias';

export type DroppedArtifactReason =
  | 'weak_topic'
  | 'generic_term_isolated'
  | 'alias_not_entity'
  | 'episodic_gate'
  | 'static_or_panorama'
  | 'document_snapshot'
  | 'negation'
  | 'correction_superseded'
  | 'test_fragment'
  | 'non_conclusive_episode';

export interface DroppedArtifact {
  kind: DroppedArtifactKind;
  reason: DroppedArtifactReason;
  originalRef: string;
  sourceExcerpt: string;
  note?: string;
}

export interface CompiledEntity {
  name: string;
  entityType: EntityType;
  sourceExcerpt: string;
  confidence: number;
  resolvedEntityId?: string | null;
  resolvedEntityName?: string | null;
}

export interface CompiledAlias {
  alias: string;
  targetEntityName: string;
  sourceExcerpt: string;
  confidence: number;
  negatedFormer?: string | null;
}

export interface CompiledEvent {
  eventType: string;
  description: string;
  occurredAt: string | null;
  sourceExcerpt: string;
  confidence: number;
  entityNames: string[];
  episodicConfidence: 'high' | 'medium' | 'low';
}

export interface CompiledAssertion {
  assertionType: string;
  content: string;
  status: string;
  sourceExcerpt: string;
  confidence: number;
}

export interface CompiledTask {
  title: string;
  description: string | null;
  dueAt: string | null;
  temporalReferenceText: string | null;
  sourceExcerpt: string;
  confidence: number;
  isCommitment: boolean;
}

export interface CompiledClarificationCandidate {
  targetType: string;
  targetReference: string;
  issueType: string;
  question: string;
  reason: string;
  priority: string;
  blockingScope: string;
  suggestedAnswers: string[];
  sourceExcerpt: string;
}

export interface CompilerFlags {
  negatedTerms: string[];
  explicitAliasLabels: string[];
  blockedClarificationRefs: string[];
  weakTopicsPreserved: string[];
}

export interface CompiledExtraction {
  compilerVersion: typeof MEMORY_COMPILER_VERSION;
  entities: CompiledEntity[];
  aliases: CompiledAlias[];
  events: CompiledEvent[];
  assertions: CompiledAssertion[];
  tasks: CompiledTask[];
  clarificationCandidates: CompiledClarificationCandidate[];
  compilerNotes: string[];
  droppedArtifacts: DroppedArtifact[];
  flags: CompilerFlags;
}

export interface MemoryCompilerInput {
  rawContent: string;
  sourceChannel: string;
  sourceMode: string;
  extractorOutput: ExtractorOutput;
  resolvedMap: ResolvedEntityMap;
  corrections?: string[];
}

export interface ShadowCompilerSummary {
  compilerVersion: string;
  entityCount: number;
  aliasCount: number;
  eventCount: number;
  assertionCount: number;
  taskCount: number;
  clarificationCandidateCount: number;
  droppedCount: number;
  droppedReasons: Record<string, number>;
  compilerNotesCount: number;
  inputContentHash: string;
}
