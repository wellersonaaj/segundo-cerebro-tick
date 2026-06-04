import type { CalibrationExpectations } from '../compiler-v1/types.js';
import type { ExtractorOutput } from '../../types/domain.js';
import type { CompiledExtraction } from '../../types/memory-compiler.js';
import { evaluateCase } from '../compiler-v1/evaluate-case.js';
import { auditEntityPrecision } from '../compiler-v1/entity-audit.js';

export type AuditClassification =
  | 'A_compiler_deterministic'
  | 'B_fixture_incomplete'
  | 'C_schema_signal_gap'
  | 'D_extractor_prompt'
  | 'E_legitimate_ambiguity'
  | 'F_metric_or_label_error';

export interface ExtractorV13Summary {
  entity_names: string[];
  entity_aliases_inline: string[];
  event_types: string[];
  event_descriptions: string[];
  clarification_count: number;
  assertion_count: number;
  has_review_flags: boolean;
}

export interface CompiledV1Retrospective {
  entities: string[];
  alias_targets: string[];
  events: string[];
  dropped_reasons: string[];
}

export interface LiveCaptureAuditInput {
  scenario_id: string;
  category: string;
  repetition_index: number;
  raw_content: string;
  extractor_output: ExtractorOutput;
  expected: CalibrationExpectations;
  compiled_v1?: CompiledExtraction;
}

export interface LiveCaptureAuditRow {
  scenario_id: string;
  category: string;
  repetition: number;
  raw_content_excerpt: string;
  extractor_v13_summary: ExtractorV13Summary;
  compiled_v1_retrospective: CompiledV1Retrospective | null;
  expected: CalibrationExpectations;
  evaluation_failures: string[];
  evaluation_passed: boolean;
  entity_audit: {
    precision: number | null;
    false_positives: string[];
    false_negatives: string[];
    divergence_notes: string[];
  };
  classification: AuditClassification;
  root_cause: string;
  missing_v14_fields: string[];
  v2_deterministic_rule: string | null;
  primary_evidence: string;
}

export function summarizeExtractorV13(output: ExtractorOutput): ExtractorV13Summary {
  return {
    entity_names: output.entities.map((e) => e.name),
    entity_aliases_inline: output.entities.flatMap((e) => e.aliases ?? []),
    event_types: output.events.map((e) => e.event_type),
    event_descriptions: output.events.map((e) => e.description),
    clarification_count: output.clarification_requests.length,
    assertion_count: output.assertions.length,
    has_review_flags: output.requires_review || (output.review_reasons?.length ?? 0) > 0,
  };
}

export function summarizeCompiledV1(compiled: CompiledExtraction): CompiledV1Retrospective {
  const dropped_reasons = [...new Set(compiled.droppedArtifacts.map((d) => d.reason))];
  return {
    entities: compiled.entities.map((e) => e.name),
    alias_targets: compiled.aliases.map((a) => a.targetEntityName),
    events: compiled.events.map((e) => e.eventType),
    dropped_reasons,
  };
}

function excerpt(text: string, max = 96): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 3)}...`;
}

function inferMissingV14Fields(
  category: string,
  failures: string[],
  summary: ExtractorV13Summary,
): string[] {
  const missing = new Set<string>();

  if (category.includes('alias') || failures.some((f) => f.includes('alias_targets'))) {
    missing.add('aliases[].target_reference');
    missing.add('aliases[].negated_former_references');
  }
  if (category.includes('episodic') || failures.some((f) => f.includes('events'))) {
    missing.add('events[].event_kind');
    missing.add('events[].episodic_confidence');
    missing.add('events[].related_entities');
  }
  if (category.includes('correction')) {
    missing.add('correction_signals[].source_block_reference');
  }
  if (summary.entity_aliases_inline.length > 0 && category.includes('bootstrap')) {
    missing.add('aliases[] (panorama parenthetical)');
  }
  if (summary.has_review_flags) {
    missing.add('review_hints[] (substituir requires_review/review_reasons)');
  }
  if (summary.entity_names.some((n) => /fox|zeta|codinome/i.test(n))) {
    missing.add('entity_mentions[] sem entidade para codinome');
  }
  if (category === 'static_preferences') {
    missing.add('assertions[] estruturadas (opinion/preference)');
  }

  return [...missing];
}

function inferV2Rule(category: string, missing: string[]): string | null {
  if (missing.some((m) => m.includes('target_reference'))) {
    return 'target_reference → Memory Resolver → entity_id; não persistir codinome como entidade';
  }
  if (missing.some((m) => m.includes('event_kind'))) {
    return 'Gate por event_kind + episodic_confidence; event_entities de related_entities';
  }
  if (missing.some((m) => m.includes('correction_signals'))) {
    return 'Supersede por correction_signals + source_block_reference permitido';
  }
  if (category === 'static_preferences') {
    return 'Preferências → ExtractedAssertion opinion; episodic_confidence=0';
  }
  return null;
}

export function classifyAuditRow(input: {
  category: string;
  evaluation_failures: string[];
  evaluation_passed: boolean;
  entity_precision: number | null;
  false_positives: string[];
  false_negatives: string[];
  entity_audit_notes: string[];
  extractor_summary: ExtractorV13Summary;
  expected: CalibrationExpectations;
}): { classification: AuditClassification; root_cause: string; primary_evidence: string } {
  const blob = input.evaluation_failures.join(' ').toLowerCase();
  const mustHaveEntities = (input.expected.must_have?.entities as string[] | undefined) ?? [];
  const mustHaveAliases = (input.expected.must_have?.alias_targets as string[] | undefined) ?? [];
  const mustHaveEvents = (input.expected.must_have?.events as string[] | undefined) ?? [];

  if (
    input.entity_precision === 0 &&
    mustHaveEntities.length === 0 &&
    (mustHaveAliases.length > 0 || mustHaveEvents.length > 0)
  ) {
    return {
      classification: 'F_metric_or_label_error',
      root_cause: 'entity_precision mede entidades mas o contrato live exige alias_targets ou events',
      primary_evidence: `precision=${input.entity_precision}`,
    };
  }

  if (blob.includes('alias_targets') && input.category.includes('alias')) {
    const foxEntity = input.extractor_summary.entity_names.some((n) =>
      /fox|zeta|codinome/i.test(n),
    );
    return {
      classification: foxEntity ? 'C_schema_signal_gap' : 'D_extractor_prompt',
      root_cause: foxEntity
        ? 'v1.3 modela codinome como entidade; v1.4 exige aliases[] + target_reference'
        : 'alias não materializado no compiler v1',
      primary_evidence: blob.slice(0, 120) || input.false_negatives.join(', '),
    };
  }

  if (blob.includes('must_have.events') && input.category.includes('episodic')) {
    const taxonomyOnly = input.extractor_summary.event_types.every((t) =>
      ['conversation', 'communication', 'message', 'statement'].includes(t),
    );
    return {
      classification: taxonomyOnly ? 'C_schema_signal_gap' : 'B_fixture_incomplete',
      root_cause: taxonomyOnly
        ? 'event_type livre v1.3 vs event_kind canônico'
        : 'expected fixo meeting/confirmation vs variabilidade live',
      primary_evidence: `events=${JSON.stringify(input.extractor_summary.event_types)}`,
    };
  }

  if (blob.includes('must_not_have.entities') && blob.includes('integração')) {
    return {
      classification: 'A_compiler_deterministic',
      root_cause: 'tópico fraco filtrável com entity_mentions + related_entities',
      primary_evidence: blob,
    };
  }

  if (input.category.includes('correction') && input.evaluation_passed) {
    return {
      classification: 'C_schema_signal_gap',
      root_cause: 'v1 passa por regex; v1.4 precisa correction_signals estruturados',
      primary_evidence: 'evaluation_passed com supersede heurístico v1',
    };
  }

  if (input.category === 'static_preferences') {
    return {
      classification: 'B_fixture_incomplete',
      root_cause: 'allowed usa nome canônico; extractor emite nomes curtos',
      primary_evidence: `entities=${JSON.stringify(input.extractor_summary.entity_names)}`,
    };
  }

  if (input.extractor_summary.clarification_count > 0 && blob.includes('forbidden_outputs')) {
    return {
      classification: 'E_legitimate_ambiguity',
      root_cause: 'clarificação sobre codinome; CM filtra pós-v1.4',
      primary_evidence: blob,
    };
  }

  if (input.evaluation_passed) {
    return {
      classification: 'A_compiler_deterministic',
      root_cause: 'gate v1 absorveu ou saída alinhada ao expected live',
      primary_evidence: 'evaluation_passed',
    };
  }

  if (input.false_positives.length > 0 && mustHaveEntities.length === 0) {
    return {
      classification: 'F_metric_or_label_error',
      root_cause: 'FPs sem must_have.entities no expected',
      primary_evidence: `fps=${JSON.stringify(input.false_positives)}`,
    };
  }

  return {
    classification: 'D_extractor_prompt',
    root_cause: 'variabilidade v1.3 não coberta por regra determinística v1',
    primary_evidence: input.evaluation_failures.join('; ') || 'shape variability',
  };
}

export function auditLiveCapture(input: LiveCaptureAuditInput): LiveCaptureAuditRow {
  const summary = summarizeExtractorV13(input.extractor_output);
  const testCase = {
    scenario_id: input.scenario_id,
    category: input.category,
    raw_content: input.raw_content,
    source_channel: 'calibration-live',
    source_mode: 'conversational' as const,
    received_at: '2026-06-01T12:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    fixture_origin: 'captured' as const,
    extractor_version: 'extractor-v1.3',
    captured_at: new Date().toISOString(),
    extractor_output: input.extractor_output,
    expected: input.expected,
  };

  let compiledRetrospective: CompiledV1Retrospective | null = null;
  let evaluation_failures: string[] = [];
  let evaluation_passed = true;

  if (input.compiled_v1) {
    compiledRetrospective = summarizeCompiledV1(input.compiled_v1);
    const evaluation = evaluateCase(testCase, input.extractor_output, input.compiled_v1);
    evaluation_failures = evaluation.failures;
    evaluation_passed = evaluation.passed;
  }

  const entityAudit = input.compiled_v1
    ? auditEntityPrecision(testCase, input.extractor_output, input.compiled_v1)
    : {
        scenario_entity_precision: null,
        false_positives: [] as string[],
        false_negatives: [] as string[],
        divergence_classifications: [] as Array<{ classification: string; rationale: string }>,
      };

  const entity_audit_notes = entityAudit.divergence_classifications.map(
    (d) => `${d.classification}: ${d.rationale}`,
  );

  const { classification, root_cause, primary_evidence } = classifyAuditRow({
    category: input.category,
    evaluation_failures,
    evaluation_passed,
    entity_precision: entityAudit.scenario_entity_precision ?? null,
    false_positives: entityAudit.false_positives,
    false_negatives: entityAudit.false_negatives,
    entity_audit_notes,
    extractor_summary: summary,
    expected: input.expected,
  });

  const missing_v14_fields = inferMissingV14Fields(
    input.category,
    evaluation_failures,
    summary,
  );

  return {
    scenario_id: input.scenario_id,
    category: input.category,
    repetition: input.repetition_index,
    raw_content_excerpt: excerpt(input.raw_content),
    extractor_v13_summary: summary,
    compiled_v1_retrospective: compiledRetrospective,
    expected: input.expected,
    evaluation_failures,
    evaluation_passed,
    entity_audit: {
      precision: entityAudit.scenario_entity_precision ?? null,
      false_positives: entityAudit.false_positives,
      false_negatives: entityAudit.false_negatives,
      divergence_notes: entity_audit_notes,
    },
    classification,
    root_cause,
    missing_v14_fields,
    v2_deterministic_rule: inferV2Rule(input.category, missing_v14_fields),
    primary_evidence,
  };
}

export function aggregateClassifications(
  rows: LiveCaptureAuditRow[],
): Record<AuditClassification, number> {
  const counts = {} as Record<AuditClassification, number>;
  for (const row of rows) {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  }
  return counts;
}

export function aggregateByCategory(
  rows: LiveCaptureAuditRow[],
): Record<string, { count: number; classifications: Record<string, number> }> {
  const out: Record<string, { count: number; classifications: Record<string, number> }> = {};
  for (const row of rows) {
    const bucket = out[row.category] ?? { count: 0, classifications: {} };
    bucket.count += 1;
    bucket.classifications[row.classification] =
      (bucket.classifications[row.classification] ?? 0) + 1;
    out[row.category] = bucket;
  }
  return out;
}
