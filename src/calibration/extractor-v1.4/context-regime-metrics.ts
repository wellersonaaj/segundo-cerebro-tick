import type { ExtractorOutputV14, TaskOperation } from '../../openai/extractor-v1.4.types.js';
import type { CompiledClarificationCandidateV2, CompiledMemoryV2 } from '../../types/memory-compiler-v2.js';
import type { CalibrationRegime } from '../../types/ingestion-context.js';
import type { V14CalibrationExpectations } from './fixed-calibration-expectations.js';
import { ratioOrNull } from './metric-ratio.js';

export interface ContextRegimeMetrics {
  first_contact_false_blocking_rate: number;
  incremental_update_false_blocking_rate: number;
  task_signal_emission_recall: number;
  context_resolution_success_rate: number;
  true_ambiguity_clarification_recall: number;
}

export interface ContextRegimeAccumulator {
  fcAcceptedRuns: number;
  fcFalseBlockingRuns: number;
  incAcceptedRuns: number;
  incFalseBlockingRuns: number;
  taskEmissionExpected: number;
  taskEmissionFound: number;
  contextResolveExpected: number;
  contextResolveSuccess: number;
  ambiguityExpected: number;
  ambiguityBlockingFound: number;
}

export function createContextRegimeAccumulator(): ContextRegimeAccumulator {
  return {
    fcAcceptedRuns: 0,
    fcFalseBlockingRuns: 0,
    incAcceptedRuns: 0,
    incFalseBlockingRuns: 0,
    taskEmissionExpected: 0,
    taskEmissionFound: 0,
    contextResolveExpected: 0,
    contextResolveSuccess: 0,
    ambiguityExpected: 0,
    ambiguityBlockingFound: 0,
  };
}

function isBlockingClarification(c: CompiledClarificationCandidateV2): boolean {
  return c.blockingScope !== 'none' && c.priority !== 'low';
}

function hasTaskOperationsInExtractor(
  output: ExtractorOutputV14,
  ops: TaskOperation[],
): boolean {
  return ops.every((op) => (output.task_signals ?? []).some((s) => s.operation === op));
}

export function accumulateContextRegimeMetrics(
  acc: ContextRegimeAccumulator,
  regime: CalibrationRegime | undefined,
  expected: V14CalibrationExpectations,
  output: ExtractorOutputV14,
  compiled: CompiledMemoryV2,
  recommended: CompiledClarificationCandidateV2[],
): void {
  const ops = expected.must_have?.task_operations ?? [];
  if (ops.length > 0) {
    acc.taskEmissionExpected += 1;
    if (hasTaskOperationsInExtractor(output, ops)) {
      acc.taskEmissionFound += 1;
    }
  }

  if (regime === 'first_contact' && expected.decision === 'accepted') {
    acc.fcAcceptedRuns += 1;
    if (recommended.some(isBlockingClarification)) {
      acc.fcFalseBlockingRuns += 1;
    }
  }

  if (regime === 'incremental_single' && expected.decision === 'accepted') {
    acc.incAcceptedRuns += 1;
    if (recommended.some(isBlockingClarification)) {
      acc.incFalseBlockingRuns += 1;
    }
    if (expected.must_have?.context_resolution === 'auto') {
      acc.contextResolveExpected += 1;
      const resolved = compiled.contextResolutionEvidence.length > 0;
      const hasOp = ops.every((op) => compiled.tasks.some((t) => t.operation === op));
      if (resolved && hasOp) acc.contextResolveSuccess += 1;
    }
  }

  if (regime === 'incremental_ambiguous') {
    acc.ambiguityExpected += 1;
    if (
      recommended.some(
        (c) =>
          isBlockingClarification(c) && c.issueType === 'ambiguous_task_reference',
      )
    ) {
      acc.ambiguityBlockingFound += 1;
    }
  }
}

export function finalizeContextRegimeMetrics(
  acc: ContextRegimeAccumulator,
): ContextRegimeMetrics {
  const ratio = (n: number, d: number) => ratioOrNull(n, d) ?? 1;

  return {
    first_contact_false_blocking_rate: ratio(acc.fcFalseBlockingRuns, acc.fcAcceptedRuns),
    incremental_update_false_blocking_rate: ratio(
      acc.incFalseBlockingRuns,
      acc.incAcceptedRuns,
    ),
    task_signal_emission_recall: ratio(acc.taskEmissionFound, acc.taskEmissionExpected),
    context_resolution_success_rate: ratio(
      acc.contextResolveSuccess,
      acc.contextResolveExpected,
    ),
    true_ambiguity_clarification_recall: ratio(
      acc.ambiguityBlockingFound,
      acc.ambiguityExpected,
    ),
  };
}

export const CONTEXT_REGIME_THRESHOLDS = {
  first_contact_false_blocking_rate: 0.05,
  incremental_update_false_blocking_rate: 0.05,
  task_signal_emission_recall: 0.95,
  context_resolution_success_rate: 0.95,
  true_ambiguity_clarification_recall: 1.0,
};
