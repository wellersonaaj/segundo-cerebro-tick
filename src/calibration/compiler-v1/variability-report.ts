import type { CalibrationMetrics } from './metrics.js';
import type { LiveCaptureRecord, LiveDivergenceClass } from './live-capture.js';
import type { EntityAuditRow } from './entity-audit.js';

export interface VariabilityCategorySummary {
  category: string;
  execution_count: number;
  distinct_extractor_shapes: number;
  entity_precision_avg: number | null;
  event_precision_avg: number | null;
  alias_as_entity_rate: number;
  preference_to_event_rate: number;
  negation_error_rate: number;
  false_clarification_rate: number;
  divergence_classes: Record<LiveDivergenceClass, number>;
  top_divergences: string[];
  representative_examples: Array<{
    scenario_id: string;
    shape_hash: string;
    entity_names: string[];
    event_types: string[];
  }>;
}

export interface VariabilityReport {
  generated_at: string;
  total_executions: number;
  categories: VariabilityCategorySummary[];
  schema_gaps_observed: string[];
  compiler_absorbed_patterns: string[];
  compiler_unsafe_patterns: string[];
  divergence_classifications: Array<{
    scenario_id: string;
    category: string;
    classification: LiveDivergenceClass;
    rationale: string;
  }>;
  aggregate_metrics: CalibrationMetrics;
}

export function buildVariabilityReport(input: {
  captures: LiveCaptureRecord[];
  audits: EntityAuditRow[];
  metricsPerRun: CalibrationMetrics[];
  divergences: VariabilityReport['divergence_classifications'];
  aggregate: CalibrationMetrics;
}): VariabilityReport {
  const byCategory = new Map<string, {
    captures: LiveCaptureRecord[];
    audits: EntityAuditRow[];
    metrics: CalibrationMetrics[];
  }>();

  for (let i = 0; i < input.captures.length; i++) {
    const cap = input.captures[i]!;
    const bucket = byCategory.get(cap.category) ?? { captures: [], audits: [], metrics: [] };
    bucket.captures.push(cap);
    bucket.audits.push(input.audits[i]!);
    bucket.metrics.push(input.metricsPerRun[i]!);
    byCategory.set(cap.category, bucket);
  }

  const categories: VariabilityCategorySummary[] = [];

  for (const [category, bucket] of byCategory) {
    const shapes = new Set(bucket.captures.map((c) => c.output_shape_hash));
    const entityPrecisions = bucket.audits
      .map((a) => a.scenario_entity_precision)
      .filter((v): v is number => v != null);
    const eventPrecisions = bucket.metrics.map((m) => m.event_precision);

    const divClasses = {} as Record<LiveDivergenceClass, number>;
    for (const d of input.divergences.filter((x) => x.category === category)) {
      divClasses[d.classification] = (divClasses[d.classification] ?? 0) + 1;
    }

    categories.push({
      category,
      execution_count: bucket.captures.length,
      distinct_extractor_shapes: shapes.size,
      entity_precision_avg:
        entityPrecisions.length > 0
          ? entityPrecisions.reduce((a, b) => a + b, 0) / entityPrecisions.length
          : null,
      event_precision_avg:
        eventPrecisions.length > 0
          ? eventPrecisions.reduce((a, b) => a + b, 0) / eventPrecisions.length
          : null,
      alias_as_entity_rate:
        bucket.metrics.reduce((s, m) => s + m.alias_as_entity_rate, 0) / bucket.metrics.length,
      preference_to_event_rate:
        bucket.metrics.reduce((s, m) => s + m.preference_to_event_rate, 0) / bucket.metrics.length,
      negation_error_rate:
        bucket.metrics.reduce((s, m) => s + m.negation_error_rate, 0) / bucket.metrics.length,
      false_clarification_rate:
        bucket.metrics.reduce((s, m) => s + m.false_clarification_rate, 0) / bucket.metrics.length,
      divergence_classes: divClasses,
      top_divergences: input.divergences
        .filter((d) => d.category === category)
        .slice(0, 5)
        .map((d) => `${d.classification}: ${d.rationale}`),
      representative_examples: bucket.captures.slice(0, 3).map((c) => ({
        scenario_id: c.scenario_id,
        shape_hash: c.output_shape_hash,
        entity_names: c.extractor_output.entities.map((e) => e.name),
        event_types: c.extractor_output.events.map((e) => e.event_type),
      })),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    total_executions: input.captures.length,
    categories,
    schema_gaps_observed: [
      'ExtractedAlias { alias, canonical_target, negated_former } — alias reassignment/negation',
      'ExtractedEvent.episodic_confidence — gate episódico conservador',
      'ExtractedAssertion { correction_reference, negated_subject } — correções acumuladas',
    ],
    compiler_absorbed_patterns: [
      'generic_term_isolated (financeiro, engenharia)',
      'alias_not_entity (panorama parentheses)',
      'correction_superseded (participant/sender)',
      'static_or_panorama event drop',
      'weak_topic (integração isolada)',
    ],
    compiler_unsafe_patterns: [
      'alias reassignment when extractor uses non-canonical phrasing (Fox entity persists)',
      'episodic event_type variability from live extractor',
      'accumulated correction chains with intermediate actors',
    ],
    divergence_classifications: input.divergences,
    aggregate_metrics: input.aggregate,
  };
}

export function formatVariabilitySummary(report: VariabilityReport): string {
  const lines = [
    '# Live Variability Summary',
    '',
    `Total executions: ${report.total_executions}`,
    '',
  ];
  for (const cat of report.categories) {
    lines.push(`## ${cat.category}`);
    lines.push(`- executions: ${cat.execution_count}`);
    lines.push(`- distinct shapes: ${cat.distinct_extractor_shapes}`);
    lines.push(`- entity_precision_avg: ${cat.entity_precision_avg?.toFixed(3) ?? 'n/a'}`);
    lines.push(`- event_precision_avg: ${cat.event_precision_avg?.toFixed(3) ?? 'n/a'}`);
    lines.push(`- alias_as_entity_rate: ${cat.alias_as_entity_rate.toFixed(3)}`);
    lines.push(`- preference_to_event_rate: ${cat.preference_to_event_rate.toFixed(3)}`);
    if (cat.top_divergences.length) {
      lines.push(`- divergences: ${cat.top_divergences.join('; ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
