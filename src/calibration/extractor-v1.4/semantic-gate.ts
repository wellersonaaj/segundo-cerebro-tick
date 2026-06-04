import type { ContextRegimeAccumulator, ContextRegimeMetrics } from './context-regime-metrics.js';
import { CONTEXT_REGIME_THRESHOLDS } from './context-regime-metrics.js';
import type { V14CalibrationMetrics, V14MetricsAccumulator } from './live-metrics.js';
import { metricRatio } from './metric-ratio.js';

export const SEMANTIC_GATE_THRESHOLDS = {
  structured_output_validity: 1.0,
  alias_target_recall: 0.95,
  entity_precision: 0.95,
  event_kind_match: 0.9,
  negation_error_rate: 0,
  alias_as_entity_rate: 0,
  preference_to_event_rate: 0,
  description_corruption_rate: 0,
  task_signal_emission_recall: 0.95,
  context_resolution_success_rate: 0.95,
  task_recall: 0.95,
  project_status_update_recall: 1.0,
  source_block_reference_validity: 1.0,
  true_ambiguity_clarification_recall: 1.0,
  false_blocking_clarification_rate: 0.05,
} as const;

export type SemanticGateMetricResult = {
  metric: string;
  value: number | null;
  status: 'ok' | 'not_applicable';
  applicable_runs: number;
  threshold: number | string;
  comparison: '>=' | '<=' | '=';
  passed: boolean;
};

export type ClarificationMaterialityTotals = {
  blocking: number;
  non_blocking: number;
  discarded: number;
};

export type SemanticGateEvaluation = {
  metrics: SemanticGateMetricResult[];
  all_passed: boolean;
  failed_metrics: string[];
};

function checkMin(
  metric: string,
  result: ReturnType<typeof metricRatio>,
  threshold: number,
): SemanticGateMetricResult {
  if (result.status === 'not_applicable') {
    return {
      metric,
      value: null,
      status: 'not_applicable',
      applicable_runs: 0,
      threshold: `>= ${threshold}`,
      comparison: '>=',
      passed: true,
    };
  }
  return {
    metric,
    value: result.value,
    status: 'ok',
    applicable_runs: result.applicable_runs,
    threshold: `>= ${threshold}`,
    comparison: '>=',
    passed: result.value! >= threshold,
  };
}

function checkMax(
  metric: string,
  result: ReturnType<typeof metricRatio>,
  threshold: number,
): SemanticGateMetricResult {
  if (result.status === 'not_applicable') {
    return {
      metric,
      value: null,
      status: 'not_applicable',
      applicable_runs: 0,
      threshold: `<= ${threshold}`,
      comparison: '<=',
      passed: true,
    };
  }
  return {
    metric,
    value: result.value,
    status: 'ok',
    applicable_runs: result.applicable_runs,
    threshold: `<= ${threshold}`,
    comparison: '<=',
    passed: result.value! <= threshold,
  };
}

function checkEq(
  metric: string,
  result: ReturnType<typeof metricRatio>,
  threshold: number,
): SemanticGateMetricResult {
  if (result.status === 'not_applicable') {
    return {
      metric,
      value: null,
      status: 'not_applicable',
      applicable_runs: 0,
      threshold: `= ${threshold}`,
      comparison: '=',
      passed: true,
    };
  }
  return {
    metric,
    value: result.value,
    status: 'ok',
    applicable_runs: result.applicable_runs,
    threshold: `= ${threshold}`,
    comparison: '=',
    passed: result.value === threshold,
  };
}

export function evaluateSemanticGate(
  liveAcc: V14MetricsAccumulator,
  metrics: V14CalibrationMetrics,
  contextAcc: ContextRegimeAccumulator,
  _contextMetrics: ContextRegimeMetrics,
): SemanticGateEvaluation {
  const results: SemanticGateMetricResult[] = [
    checkEq(
      'structured_output_validity',
      metricRatio(liveAcc.structuredOutputValid, liveAcc.totalRuns),
      SEMANTIC_GATE_THRESHOLDS.structured_output_validity,
    ),
    checkMin(
      'alias_target_recall',
      metricRatio(liveAcc.aliasTargetFound, liveAcc.aliasTargetExpected),
      SEMANTIC_GATE_THRESHOLDS.alias_target_recall,
    ),
    liveAcc.entityApplicableRuns === 0
      ? {
          metric: 'entity_precision',
          value: null,
          status: 'not_applicable',
          applicable_runs: 0,
          threshold: `>= ${SEMANTIC_GATE_THRESHOLDS.entity_precision}`,
          comparison: '>=',
          passed: true,
        }
      : checkMin(
          'entity_precision',
          metricRatio(liveAcc.entityTp, liveAcc.entityEvaluated),
          SEMANTIC_GATE_THRESHOLDS.entity_precision,
        ),
    checkMin(
      'event_kind_match',
      metricRatio(liveAcc.eventKindMatch, liveAcc.eventKindExpected),
      SEMANTIC_GATE_THRESHOLDS.event_kind_match,
    ),
    checkEq(
      'negation_error_rate',
      metricRatio(liveAcc.negationErrors, liveAcc.negationCases),
      SEMANTIC_GATE_THRESHOLDS.negation_error_rate,
    ),
    checkEq(
      'alias_as_entity_rate',
      metricRatio(liveAcc.aliasAsEntity, liveAcc.totalRuns),
      SEMANTIC_GATE_THRESHOLDS.alias_as_entity_rate,
    ),
    checkEq(
      'preference_to_event_rate',
      metricRatio(liveAcc.preferenceEvents, liveAcc.preferenceCases),
      SEMANTIC_GATE_THRESHOLDS.preference_to_event_rate,
    ),
    checkEq(
      'description_corruption_rate',
      metricRatio(liveAcc.descriptionCorruptions, liveAcc.totalRuns),
      SEMANTIC_GATE_THRESHOLDS.description_corruption_rate,
    ),
    checkMin(
      'task_signal_emission_recall',
      metricRatio(contextAcc.taskEmissionFound, contextAcc.taskEmissionExpected),
      SEMANTIC_GATE_THRESHOLDS.task_signal_emission_recall,
    ),
    checkMin(
      'context_resolution_success_rate',
      metricRatio(contextAcc.contextResolveSuccess, contextAcc.contextResolveExpected),
      SEMANTIC_GATE_THRESHOLDS.context_resolution_success_rate,
    ),
    checkMin(
      'task_recall',
      metricRatio(liveAcc.taskFound, liveAcc.taskExpected),
      SEMANTIC_GATE_THRESHOLDS.task_recall,
    ),
    checkMin(
      'project_status_update_recall',
      metricRatio(liveAcc.projectStatusFound, liveAcc.projectStatusExpected),
      SEMANTIC_GATE_THRESHOLDS.project_status_update_recall,
    ),
    checkEq(
      'source_block_reference_validity',
      metricRatio(liveAcc.sourceBlockValid, liveAcc.sourceBlockRefs),
      SEMANTIC_GATE_THRESHOLDS.source_block_reference_validity,
    ),
    checkMin(
      'true_ambiguity_clarification_recall',
      metricRatio(contextAcc.ambiguityBlockingFound, contextAcc.ambiguityExpected),
      SEMANTIC_GATE_THRESHOLDS.true_ambiguity_clarification_recall,
    ),
    checkMax(
      'false_blocking_clarification_rate',
      metricRatio(liveAcc.falseClarificationRuns, liveAcc.acceptedExpectationRuns),
      SEMANTIC_GATE_THRESHOLDS.false_blocking_clarification_rate,
    ),
  ];

  const failed_metrics = results.filter((r) => !r.passed).map((r) => r.metric);
  return {
    metrics: results,
    all_passed: failed_metrics.length === 0,
    failed_metrics,
  };
}

export type ResidualClass =
  | 'alias_resolution'
  | 'entity_precision'
  | 'event_kind'
  | 'negation'
  | 'preference_leak'
  | 'task_context'
  | 'clarification'
  | 'source_block'
  | 'structured_output'
  | 'other';

export function classifyResidual(failures: string[]): ResidualClass {
  const text = failures.join(' ').toLowerCase();
  if (text.includes('alias')) return 'alias_resolution';
  if (text.includes('entity')) return 'entity_precision';
  if (text.includes('event')) return 'event_kind';
  if (text.includes('negat') || text.includes('reassign')) return 'negation';
  if (text.includes('preference') || text.includes('event leak')) return 'preference_leak';
  if (text.includes('task') || text.includes('context') || text.includes('due')) return 'task_context';
  if (text.includes('clarif')) return 'clarification';
  if (text.includes('source_block') || text.includes('source block')) return 'source_block';
  if (text.includes('schema') || text.includes('structured')) return 'structured_output';
  return 'other';
}

export function buildGateRecommendation(
  evaluation: SemanticGateEvaluation,
  totalRuns: number,
  casePassRate: number,
): string {
  if (evaluation.all_passed && casePassRate >= 0.95) {
    return 'Avançar para normalização determinística de datas (próximo bloco planejado), mantendo quality gate amplo em monitoramento.';
  }
  if (evaluation.failed_metrics.length <= 2 && casePassRate >= 0.9) {
    return 'Executar correção pontual dirigida nas categorias/métricas abaixo do threshold antes da normalização de datas.';
  }
  return 'Não avançar para normalização de datas: repetir calibração live dirigida nas categorias com residuais e métricas reprovadas.';
}

export function clarificationMaterialityFromAccumulator(
  acc: V14MetricsAccumulator,
): ClarificationMaterialityTotals {
  return {
    blocking: acc.clarificationBlockingTotal,
    non_blocking: acc.clarificationNonBlockingTotal,
    discarded: acc.clarificationDiscardedTotal,
  };
}

/** Re-export for reports that still reference context thresholds. */
export { CONTEXT_REGIME_THRESHOLDS };
