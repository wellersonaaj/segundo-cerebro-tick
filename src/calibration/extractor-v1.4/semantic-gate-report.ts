import {
  finalizeContextRegimeMetrics,
  type ContextRegimeAccumulator,
  type ContextRegimeMetrics,
} from './context-regime-metrics.js';
import type { V14CalibrationMetrics, V14MetricsAccumulator } from './live-metrics.js';
import { finalizeV14Metrics } from './live-metrics.js';
import {
  buildGateRecommendation,
  classifyResidual,
  clarificationMaterialityFromAccumulator,
  evaluateSemanticGate,
  SEMANTIC_GATE_THRESHOLDS,
  type SemanticGateEvaluation,
  type SemanticGateMetricResult,
} from './semantic-gate.js';

export interface SemanticGateRunMeta {
  run_id: string;
  extractor_version: string;
  schema_version: string;
  prompt_version: string;
  started_at: string;
  finished_at: string;
  categories: string[];
  repetitions: number;
  total_runs: number;
}

export interface SemanticGateCategoryRow {
  category: string;
  passed: number;
  total: number;
  pass_rate: number;
  metrics: Record<string, number | null>;
  gate: SemanticGateEvaluation;
}

export interface SemanticGateResidual {
  scenario_id: string;
  category: string;
  repetition: number;
  residual_class: ReturnType<typeof classifyResidual>;
  failures: string[];
}

export interface SemanticGateReport {
  meta: SemanticGateRunMeta;
  thresholds: typeof SEMANTIC_GATE_THRESHOLDS;
  aggregate: {
    metrics: V14CalibrationMetrics;
    context_metrics: ContextRegimeMetrics;
    gate: SemanticGateEvaluation;
    clarification_materiality: ReturnType<typeof clarificationMaterialityFromAccumulator>;
    case_pass_rate: number;
    recommendation: string;
  };
  by_category: SemanticGateCategoryRow[];
  residuals: SemanticGateResidual[];
  pass: boolean;
}

function formatMetricValue(m: SemanticGateMetricResult): string {
  if (m.status === 'not_applicable') return 'N/A';
  return String(m.value);
}

export function buildSemanticGateReport(input: {
  meta: SemanticGateRunMeta;
  liveAcc: V14MetricsAccumulator;
  contextAcc: ContextRegimeAccumulator;
  contextMetrics: ContextRegimeMetrics;
  byCategoryAcc: Record<
    string,
    {
      live: V14MetricsAccumulator;
      context: ContextRegimeAccumulator;
      passed: number;
      total: number;
    }
  >;
  failedRows: Array<{
    scenario_id: string;
    category: string;
    repetition: number;
    failures: string[];
  }>;
  casePassed: number;
  caseTotal: number;
}): SemanticGateReport {
  const metrics = finalizeV14Metrics(input.liveAcc);
  const gate = evaluateSemanticGate(
    input.liveAcc,
    metrics,
    input.contextAcc,
    input.contextMetrics,
  );
  const case_pass_rate =
    input.caseTotal === 0 ? 1 : Math.round((input.casePassed / input.caseTotal) * 1000) / 1000;

  const by_category: SemanticGateCategoryRow[] = Object.entries(input.byCategoryAcc).map(
    ([category, { live, context, passed, total }]) => {
      const catMetrics = finalizeV14Metrics(live);
      const catContext = finalizeContextRegimeMetrics(context);
      const catGate = evaluateSemanticGate(live, catMetrics, context, catContext);
      return {
        category,
        passed,
        total,
        pass_rate: total === 0 ? 1 : Math.round((passed / total) * 1000) / 1000,
        metrics: pickReportMetrics(catMetrics, catContext),
        gate: catGate,
      };
    },
  );

  const residuals: SemanticGateResidual[] = input.failedRows.map((r) => ({
    scenario_id: r.scenario_id,
    category: r.category,
    repetition: r.repetition,
    residual_class: classifyResidual(r.failures),
    failures: r.failures,
  }));

  const pass = gate.all_passed && case_pass_rate >= 0.9;

  return {
    meta: { ...input.meta, finished_at: new Date().toISOString() },
    thresholds: SEMANTIC_GATE_THRESHOLDS,
    aggregate: {
      metrics,
      context_metrics: input.contextMetrics,
      gate,
      clarification_materiality: clarificationMaterialityFromAccumulator(input.liveAcc),
      case_pass_rate,
      recommendation: buildGateRecommendation(gate, input.caseTotal, case_pass_rate),
    },
    by_category,
    residuals,
    pass,
  };
}

function pickReportMetrics(
  m: V14CalibrationMetrics,
  c: ContextRegimeMetrics,
): Record<string, number | null> {
  return {
    structured_output_validity: m.structured_output_validity,
    alias_target_recall: m.alias_target_recall,
    entity_precision: m.entity_precision,
    event_kind_match: m.event_kind_match,
    negation_error_rate: m.negation_error_rate,
    alias_as_entity_rate: m.alias_as_entity_rate,
    preference_to_event_rate: m.preference_to_event_rate,
    description_corruption_rate: m.description_corruption_rate,
    task_signal_emission_recall: c.task_signal_emission_recall,
    context_resolution_success_rate: c.context_resolution_success_rate,
    task_recall: m.task_recall,
    project_status_update_recall: m.project_status_update_recall,
    source_block_reference_validity: m.source_block_reference_validity,
    true_ambiguity_clarification_recall: c.true_ambiguity_clarification_recall,
    false_blocking_clarification_rate: m.false_blocking_clarification_rate,
  };
}

export function renderSemanticGateSummaryMd(report: SemanticGateReport): string {
  const { meta, aggregate, thresholds } = report;
  const lines = [
    '# Extractor v1.4 — Semantic quality gate (Bloco 4F)',
    '',
    `**Run ID:** \`${meta.run_id}\``,
    `**Started:** ${meta.started_at}`,
    `**Finished:** ${meta.finished_at}`,
    `**Extractor:** ${meta.extractor_version} | schema ${meta.schema_version} | prompt ${meta.prompt_version}`,
    `**Runs:** ${meta.total_runs} (${meta.categories.length} categorias × ${meta.repetitions} repetições)`,
    '',
    `## Veredito: ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    aggregate.recommendation,
    '',
    '## Métricas agregadas',
    '',
    '| Métrica | Valor | Threshold | Status |',
    '|---------|-------|-----------|--------|',
    ...aggregate.gate.metrics.map((m) => {
      const thr = typeof m.threshold === 'string' ? m.threshold : String(m.threshold);
      const status = m.passed ? 'PASS' : m.status === 'not_applicable' ? 'N/A' : 'FAIL';
      return `| ${m.metric} | ${formatMetricValue(m)} | ${thr} | ${status} |`;
    }),
    '',
    '### Clarification materiality',
    '',
    `- blocking: ${aggregate.clarification_materiality.blocking}`,
    `- non_blocking: ${aggregate.clarification_materiality.non_blocking}`,
    `- discarded: ${aggregate.clarification_materiality.discarded}`,
    '',
    `**Case pass rate:** ${(aggregate.case_pass_rate * 100).toFixed(1)}%`,
    '',
    '## Por categoria',
    '',
    '| Categoria | Pass rate | Gate |',
    '|-----------|-----------|------|',
    ...report.by_category.map((c) => {
      const pr = c.total > 0 ? `${((c.passed / c.total) * 100).toFixed(0)}%` : '—';
      const gateStatus = c.gate.all_passed ? 'PASS' : 'FAIL';
      return `| ${c.category} | ${pr} (${c.passed}/${c.total}) | ${gateStatus} |`;
    }),
    '',
    '## Thresholds (referência)',
    '',
    '```json',
    JSON.stringify(thresholds, null, 2),
    '```',
    '',
  ];

  if (aggregate.gate.failed_metrics.length > 0) {
    lines.push('## Métricas abaixo do threshold', '');
    for (const m of aggregate.gate.failed_metrics) {
      lines.push(`- ${m}`);
    }
    lines.push('');
  }

  if (report.residuals.length > 0) {
    lines.push('## Residuais classificados', '');
    const byClass = new Map<string, number>();
    for (const r of report.residuals) {
      byClass.set(r.residual_class, (byClass.get(r.residual_class) ?? 0) + 1);
    }
    for (const [cls, n] of byClass) {
      lines.push(`- **${cls}**: ${n}`);
    }
    lines.push('');
    lines.push('<details><summary>Detalhe (até 20)</summary>', '');
    for (const r of report.residuals.slice(0, 20)) {
      lines.push(`- \`${r.scenario_id}\` (${r.residual_class}): ${r.failures.join('; ')}`);
    }
    lines.push('', '</details>', '');
  }

  lines.push(
    `Capturas desta execução: \`artifacts/calibration/extractor-v1.4-live-runs/${meta.run_id}/\``,
  );

  return lines.join('\n');
}
