import type { CompiledMemoryV2 } from '../../types/memory-compiler-v2.js';
import type { ExtractorOutputV14 } from '../../openai/extractor-v1.4.types.js';
import { listSourceBlockIds } from '../../utils/source-blocks.js';
import {
  isEntityPrecisionApplicable,
  matchesMustNotEntityMention,
} from './entity-mention-match.js';
import type { V14CalibrationExpectations } from './fixed-calibration-expectations.js';
import type { ClarificationManagerV2Result } from '../../services/clarification-manager-v2.service.js';
import type { V14CaseEvaluationResult } from './evaluate-v2-case.js';
import { auditNegation } from './live-audit-detail.js';
import { ratioOrNull } from './metric-ratio.js';

export interface V14CalibrationMetrics {
  structured_output_validity: number | null;
  alias_target_recall: number;
  entity_precision: number | null;
  entity_precision_applicable_runs: number;
  entity_precision_global: number | null;
  entity_precision_by_category: Record<string, number>;
  event_kind_match: number;
  negation_error_rate: number;
  alias_as_entity_rate: number;
  preference_to_event_rate: number;
  description_corruption_rate: number;
  false_clarification_rate: number;
  false_blocking_clarification_rate: number;
  clarification_blocking_total: number;
  clarification_non_blocking_total: number;
  clarification_discarded_total: number;
  task_recall: number;
  project_status_update_recall: number;
  source_block_reference_validity: number;
  needs_llm_review_rate: number;
}

export type V14ThresholdCheck =
  | { metric: string; value: number; threshold: number; passed: boolean }
  | { metric: string; value: null; status: 'not_applicable'; passed: true };

export interface V14MetricsAccumulator {
  structuredOutputValid: number;
  aliasTargetExpected: number;
  aliasTargetFound: number;
  entityTp: number;
  entityFp: number;
  entityEvaluated: number;
  entityApplicableRuns: number;
  entityByCategory: Record<string, { tp: number; evaluated: number; runs: number }>;
  eventKindExpected: number;
  eventKindMatch: number;
  negationErrors: number;
  negationCases: number;
  aliasAsEntity: number;
  preferenceEvents: number;
  preferenceCases: number;
  descriptionCorruptions: number;
  falseClarifications: number;
  falseClarificationRuns: number;
  acceptedExpectationRuns: number;
  totalClarifications: number;
  clarificationBlockingTotal: number;
  clarificationNonBlockingTotal: number;
  clarificationDiscardedTotal: number;
  taskExpected: number;
  taskFound: number;
  projectStatusExpected: number;
  projectStatusFound: number;
  sourceBlockRefs: number;
  sourceBlockValid: number;
  needsLlmReview: number;
  totalRuns: number;
}

export const V14_METRIC_THRESHOLDS: Record<string, number> = {
  alias_target_recall: 0.95,
  entity_precision: 0.95,
  entity_precision_global: 0.95,
  event_kind_match: 0.9,
  negation_error_rate: 0,
  alias_as_entity_rate: 0,
  preference_to_event_rate: 0,
  description_corruption_rate: 0,
  false_clarification_rate: 0.05,
  false_blocking_clarification_rate: 0.05,
};

/** Positive association after negation: events (and similar), not mere mention of a named person. */
export function countImproperNegationAssociations(
  output: ExtractorOutputV14,
  compiled: CompiledMemoryV2,
): number {
  const audit = auditNegation(output);
  let count = audit.improper_positive_associations.filter((m) => m.startsWith('event ')).length;

  for (const a of output.aliases) {
    for (const neg of a.negated_former_references) {
      const negNorm = neg.toLowerCase();
      for (const ev of compiled.events) {
        if (ev.relatedEntities.some((r) => r.entityReference.toLowerCase() === negNorm)) {
          count += 1;
        }
      }
      for (const assertion of compiled.assertions) {
        if (
          assertion.subjectReference.toLowerCase() === negNorm ||
          assertion.objectReference?.toLowerCase() === negNorm ||
          assertion.relatedEntityReferences.some((r) => r.toLowerCase() === negNorm)
        ) {
          count += 1;
        }
      }
    }
  }

  return count;
}

export function createV14MetricsAccumulator(): V14MetricsAccumulator {
  return {
    structuredOutputValid: 0,
    aliasTargetExpected: 0,
    aliasTargetFound: 0,
    entityTp: 0,
    entityFp: 0,
    entityEvaluated: 0,
    entityApplicableRuns: 0,
    entityByCategory: {},
    eventKindExpected: 0,
    eventKindMatch: 0,
    negationErrors: 0,
    negationCases: 0,
    aliasAsEntity: 0,
    preferenceEvents: 0,
    preferenceCases: 0,
    descriptionCorruptions: 0,
    falseClarifications: 0,
    falseClarificationRuns: 0,
    acceptedExpectationRuns: 0,
    totalClarifications: 0,
    clarificationBlockingTotal: 0,
    clarificationNonBlockingTotal: 0,
    clarificationDiscardedTotal: 0,
    taskExpected: 0,
    taskFound: 0,
    projectStatusExpected: 0,
    projectStatusFound: 0,
    sourceBlockRefs: 0,
    sourceBlockValid: 0,
    needsLlmReview: 0,
    totalRuns: 0,
  };
}

function countBlockingClarifications(
  recommended: Array<{ blockingScope: string; priority: string }>,
): number {
  return recommended.filter(
    (c) => c.blockingScope !== 'none' && c.priority !== 'low',
  ).length;
}

export function collectSourceBlockRefs(output: ExtractorOutputV14): string[] {
  return [
    ...output.correction_signals.map((c) => c.source_block_reference),
    ...output.assertions.map((a) => a.source_block_reference),
    ...((output.task_signals ?? []).map((t) => t.source_block_reference)),
    ...output.clarification_candidates.map((c) => c.source_block_reference),
  ].filter((ref): ref is string => ref != null && ref.trim() !== '');
}

export function accumulateV14Metrics(
  acc: V14MetricsAccumulator,
  expected: V14CalibrationExpectations,
  output: ExtractorOutputV14,
  compiled: CompiledMemoryV2,
  evaluation: V14CaseEvaluationResult,
  recommendedClarifications: number,
  effectiveInput: string,
  category: string,
  recommendedItems: Array<{ blockingScope: string; priority: string }> = [],
  materiality?: ClarificationManagerV2Result,
  structuredOutputValid = true,
): void {
  acc.totalRuns += 1;
  if (structuredOutputValid) {
    acc.structuredOutputValid += 1;
  }

  if (compiled.decision.status === 'needs_llm_review') {
    acc.needsLlmReview += 1;
  }

  const aliasTargets = expected.must_have?.alias_targets ?? [];
  if (aliasTargets.length > 0) {
    acc.aliasTargetExpected += aliasTargets.length;
    for (const target of aliasTargets) {
      if (compiled.aliases.some((a) => a.targetReference.includes(target) || a.targetCanonicalName === target)) {
        acc.aliasTargetFound += 1;
      }
    }
  }

  const mustNotMentions = expected.must_not_have?.entity_mentions ?? [];
  const mustHaveEntities: string[] = [];
  const applicable = isEntityPrecisionApplicable(
    category,
    mustNotMentions,
    aliasTargets,
    mustHaveEntities,
  );

  if (applicable) {
    acc.entityApplicableRuns += 1;
    const bucket = acc.entityByCategory[category] ?? { tp: 0, evaluated: 0, runs: 0 };
    bucket.runs += 1;

    for (const ent of compiled.resolvedEntities) {
      acc.entityEvaluated += 1;
      bucket.evaluated += 1;
      if (mustNotMentions.some((p) => matchesMustNotEntityMention(ent.mentionText, p))) {
        acc.entityFp += 1;
      } else {
        acc.entityTp += 1;
        bucket.tp += 1;
      }
    }

    acc.entityByCategory[category] = bucket;
  }

  const expectedKinds = expected.must_have?.event_kinds ?? [];
  if (expectedKinds.length > 0) {
    acc.eventKindExpected += expectedKinds.length;
    for (const kind of expectedKinds) {
      const found =
        category === 'episodic_confirmation' && kind === 'confirmation'
          ? compiled.events.some(
              (e) => e.eventKind === 'confirmation' || e.eventKind === 'document_sent',
            )
          : compiled.events.some((e) => e.eventKind === kind);
      if (found) {
        acc.eventKindMatch += 1;
      }
    }
  }

  if (category === 'alias_negation' || category === 'alias_reassignment') {
    acc.negationCases += 1;
    const improperPositive = countImproperNegationAssociations(output, compiled);
    if (improperPositive > 0) {
      acc.negationErrors += 1;
    }
  }

  for (const m of output.entity_mentions) {
    const isAliasLabel = output.aliases.some(
      (a) => a.alias.toLowerCase() === m.mention_text.toLowerCase(),
    );
    if (isAliasLabel && compiled.resolvedEntities.some((e) => e.mentionText === m.mention_text)) {
      acc.aliasAsEntity += 1;
    }
  }

  if (category === 'static_preferences') {
    acc.preferenceCases += 1;
    if (compiled.events.length > 0) acc.preferenceEvents += 1;
  }

  const taskOps = expected.must_have?.task_operations ?? [];
  if (taskOps.length > 0) {
    acc.taskExpected += 1;
    if (taskOps.every((op) => compiled.tasks.some((t) => t.operation === op))) {
      acc.taskFound += 1;
    }
  }

  if (category === 'project_status_update') {
    acc.projectStatusExpected += 1;
    if (compiled.assertions.some((a) => a.assertionKind === 'status_update')) {
      acc.projectStatusFound += 1;
    }
  }

  const materialBlockingCount = materiality
    ? countBlockingClarifications(materiality.blocking)
    : recommendedItems.length > 0
      ? countBlockingClarifications(recommendedItems)
      : recommendedClarifications;
  const blockingCount = materialBlockingCount;
  acc.totalClarifications += blockingCount;
  if (materiality) {
    acc.clarificationBlockingTotal += materialBlockingCount;
    acc.clarificationNonBlockingTotal += materiality.nonBlocking.length;
    acc.clarificationDiscardedTotal += materiality.discarded.length;
  }
  if (expected.decision === 'accepted') {
    acc.acceptedExpectationRuns += 1;
    if (blockingCount > 0) {
      acc.falseClarificationRuns += 1;
      acc.falseClarifications += blockingCount;
    }
  }

  if (!evaluation.passed && evaluation.failures.some((f) => f.includes('description'))) {
    acc.descriptionCorruptions += 1;
  }

  const blockIds = new Set(listSourceBlockIds(effectiveInput));
  for (const ref of collectSourceBlockRefs(output)) {
    acc.sourceBlockRefs += 1;
    if (blockIds.has(ref) || ref === '[SOURCE_BLOCK:raw]') {
      acc.sourceBlockValid += 1;
    }
  }
}

export function finalizeV14Metrics(acc: V14MetricsAccumulator): V14CalibrationMetrics {
  const ratio = (num: number, den: number) => ratioOrNull(num, den) ?? 1;

  const entity_precision_global =
    acc.entityApplicableRuns === 0 ? null : ratioOrNull(acc.entityTp, acc.entityEvaluated);
  const entity_precision_by_category: Record<string, number> = {};
  for (const [cat, bucket] of Object.entries(acc.entityByCategory)) {
    entity_precision_by_category[cat] = ratio(bucket.tp, bucket.evaluated);
  }

  return {
    structured_output_validity: ratioOrNull(acc.structuredOutputValid, acc.totalRuns),
    alias_target_recall: ratio(acc.aliasTargetFound, acc.aliasTargetExpected),
    entity_precision: entity_precision_global,
    entity_precision_applicable_runs: acc.entityApplicableRuns,
    entity_precision_global,
    entity_precision_by_category,
    event_kind_match: ratio(acc.eventKindMatch, acc.eventKindExpected),
    negation_error_rate:
      acc.negationCases === 0 ? 0 : ratio(acc.negationErrors, acc.negationCases),
    alias_as_entity_rate: ratio(acc.aliasAsEntity, acc.totalRuns),
    preference_to_event_rate: ratio(acc.preferenceEvents, acc.preferenceCases),
    description_corruption_rate: ratio(acc.descriptionCorruptions, acc.totalRuns),
    false_clarification_rate:
      ratioOrNull(acc.falseClarificationRuns, acc.acceptedExpectationRuns) ?? 0,
    false_blocking_clarification_rate:
      ratioOrNull(acc.falseClarificationRuns, acc.acceptedExpectationRuns) ?? 0,
    clarification_blocking_total: acc.clarificationBlockingTotal,
    clarification_non_blocking_total: acc.clarificationNonBlockingTotal,
    clarification_discarded_total: acc.clarificationDiscardedTotal,
    task_recall: ratio(acc.taskFound, acc.taskExpected),
    project_status_update_recall: ratio(acc.projectStatusFound, acc.projectStatusExpected),
    source_block_reference_validity: ratio(acc.sourceBlockValid, acc.sourceBlockRefs || 1),
    needs_llm_review_rate: ratio(acc.needsLlmReview, acc.totalRuns),
  };
}

export function checkV14Thresholds(
  metrics: V14CalibrationMetrics,
  acc: V14MetricsAccumulator,
): V14ThresholdCheck[] {
  const preferenceCheck: V14ThresholdCheck =
    acc.preferenceCases === 0
      ? {
          metric: 'preference_to_event_rate',
          value: null,
          status: 'not_applicable',
          passed: true,
        }
      : {
          metric: 'preference_to_event_rate',
          value: metrics.preference_to_event_rate,
          threshold: 0,
          passed: metrics.preference_to_event_rate === 0,
        };

  const checks: V14ThresholdCheck[] = [
    {
      metric: 'alias_target_recall',
      value: metrics.alias_target_recall,
      threshold: V14_METRIC_THRESHOLDS.alias_target_recall!,
      passed: metrics.alias_target_recall >= V14_METRIC_THRESHOLDS.alias_target_recall!,
    },
    {
      metric: 'event_kind_match',
      value: metrics.event_kind_match,
      threshold: V14_METRIC_THRESHOLDS.event_kind_match!,
      passed: metrics.event_kind_match >= V14_METRIC_THRESHOLDS.event_kind_match!,
    },
    {
      metric: 'negation_error_rate',
      value: metrics.negation_error_rate,
      threshold: 0,
      passed: metrics.negation_error_rate === 0,
    },
    {
      metric: 'alias_as_entity_rate',
      value: metrics.alias_as_entity_rate,
      threshold: 0,
      passed: metrics.alias_as_entity_rate === 0,
    },
    preferenceCheck,
    {
      metric: 'description_corruption_rate',
      value: metrics.description_corruption_rate,
      threshold: 0,
      passed: metrics.description_corruption_rate === 0,
    },
    {
      metric: 'false_clarification_rate',
      value: metrics.false_clarification_rate,
      threshold: V14_METRIC_THRESHOLDS.false_clarification_rate!,
      passed: metrics.false_clarification_rate <= V14_METRIC_THRESHOLDS.false_clarification_rate!,
    },
    {
      metric: 'false_blocking_clarification_rate',
      value: metrics.false_blocking_clarification_rate,
      threshold: V14_METRIC_THRESHOLDS.false_blocking_clarification_rate!,
      passed:
        metrics.false_blocking_clarification_rate <=
        V14_METRIC_THRESHOLDS.false_blocking_clarification_rate!,
    },
  ];

  if (metrics.entity_precision_applicable_runs === 0) {
    checks.splice(1, 0, {
      metric: 'entity_precision_global',
      value: null,
      status: 'not_applicable',
      passed: true,
    });
  } else {
    checks.splice(1, 0, {
      metric: 'entity_precision_global',
      value: metrics.entity_precision_global!,
      threshold: V14_METRIC_THRESHOLDS.entity_precision_global!,
      passed: metrics.entity_precision_global! >= V14_METRIC_THRESHOLDS.entity_precision_global!,
    });
  }

  return checks;
}
