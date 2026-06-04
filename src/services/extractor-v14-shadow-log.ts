import { createHash } from 'node:crypto';
import type { CompiledMemoryV2, CompiledTaskV2 } from '../types/memory-compiler-v2.js';
import { EXTRACTOR_V14_SCHEMA_VERSION } from '../openai/extractor-v1.4.prompt.js';

export interface ExtractorV14ShadowTemporalSafeLog {
  temporal_status: string;
  temporal_precision: string;
  temporal_reason_code: string;
  temporal_normalizer_version: string;
  timezone_source: string;
}

export interface ExtractorV14ShadowSafeLog {
  inbox_item_id: string;
  extraction_run_id: string;
  input_hash: string;
  extractor_v14_schema_version: string;
  compiled_decision: string;
  final_decision?: string;
  compiled_confidence: number;
  duration_ms: number;
  counts: {
    entity_mentions: number;
    aliases: number;
    events: number;
    assertions: number;
    tasks: number;
    clarification_candidates: number;
    dropped_artifacts: number;
    recommended_clarifications: number;
  };
  dropped_reasons: Record<string, number>;
  temporal?: ExtractorV14ShadowTemporalSafeLog;
  v13_comparison?: {
    entity_count: number;
    event_count: number;
  };
}

export function hashInputForShadow(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

export function summarizeDroppedReasons(
  compiled: CompiledMemoryV2,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of compiled.droppedArtifacts) {
    counts[d.reason] = (counts[d.reason] ?? 0) + 1;
  }
  return counts;
}

export function summarizeTemporalForShadow(
  tasks: CompiledTaskV2[],
): ExtractorV14ShadowTemporalSafeLog | undefined {
  const withDue = tasks.filter((t) => t.dueAt?.trim() && t.dueAtTemporal);
  if (withDue.length === 0) return undefined;
  const t = withDue[0]!.dueAtTemporal!;
  return {
    temporal_status: t.status,
    temporal_precision: t.precision,
    temporal_reason_code: t.reasonCode,
    temporal_normalizer_version: t.normalizerVersion,
    timezone_source: t.timezoneSource,
  };
}

export function buildExtractorV14ShadowSafeLog(input: {
  inboxItemId: string;
  runId: string;
  effectiveInput: string;
  compiled: CompiledMemoryV2;
  recommendedClarificationCount: number;
  finalDecisionStatus?: string;
  durationMs: number;
  v13EntityCount?: number;
  v13EventCount?: number;
}): ExtractorV14ShadowSafeLog {
  return {
    inbox_item_id: input.inboxItemId,
    extraction_run_id: input.runId,
    input_hash: hashInputForShadow(input.effectiveInput),
    extractor_v14_schema_version: EXTRACTOR_V14_SCHEMA_VERSION,
    compiled_decision: input.compiled.decision.status,
    final_decision: input.finalDecisionStatus,
    compiled_confidence: input.compiled.decision.confidence,
    duration_ms: input.durationMs,
    counts: {
      entity_mentions: input.compiled.resolvedEntities.length,
      aliases: input.compiled.aliases.length,
      events: input.compiled.events.length,
      assertions: input.compiled.assertions.length,
      tasks: input.compiled.tasks.length,
      clarification_candidates: input.compiled.clarificationCandidates.length,
      dropped_artifacts: input.compiled.droppedArtifacts.length,
      recommended_clarifications: input.recommendedClarificationCount,
    },
    dropped_reasons: summarizeDroppedReasons(input.compiled),
    temporal: summarizeTemporalForShadow(input.compiled.tasks),
    v13_comparison:
      input.v13EntityCount != null
        ? {
            entity_count: input.v13EntityCount,
            event_count: input.v13EventCount ?? 0,
          }
        : undefined,
  };
}
