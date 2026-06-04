import type { CompiledExtraction } from '../../types/memory-compiler.js';
import type { CalibrationCase, CalibrationExpectations } from './types.js';
import type { ExtractorOutput } from '../../types/domain.js';

export type EntityDivergenceClass =
  | 'A_fp_compiler'
  | 'B_fn_compiler'
  | 'C_allowed_optional'
  | 'D_fixture_incomplete'
  | 'E_legitimate_ambiguity'
  | 'F_schema_signal_gap';

export interface EntityAuditRow {
  scenario_id: string;
  category: string;
  fixture_origin: string;
  raw_content_summary: string;
  extractor_entities: string[];
  compiled_entities: string[];
  expected_must_have: string[];
  expected_allowed: string[];
  expected_optional: string[];
  expected_must_not_have: string[];
  true_positives: string[];
  false_positives: string[];
  false_negatives: string[];
  divergence_classifications: Array<{
    entity: string;
    kind: 'fp' | 'fn';
    classification: EntityDivergenceClass;
    rationale: string;
  }>;
  scenario_entity_precision: number | null;
}

function summarize(text: string, max = 72): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 3)}...`;
}

function tokenMatches(name: string, pattern: string): boolean {
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  if (n === p) return true;
  if (n.split(/\s+/).includes(p)) return true;
  return false;
}

function matchesPattern(name: string, pattern: string): boolean {
  if (tokenMatches(name, pattern)) return true;
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.length >= 5 && n.includes(p)) return true;
  if (n.length >= 5 && p.includes(n)) return true;
  return false;
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(name, p));
}

function classifyFalsePositive(
  entity: string,
  expected: CalibrationExpectations,
  testCase: CalibrationCase,
): { classification: EntityDivergenceClass; rationale: string } {
  const mustNot = (expected.must_not_have?.entities as string[] | undefined) ?? [];
  if (matchesAny(entity, mustNot)) {
    return { classification: 'A_fp_compiler', rationale: 'compiled entity violates must_not_have' };
  }

  const allowed = (expected.allowed?.entities as string[] | undefined) ?? [];
  const optional = (expected.optional?.entities as string[] | undefined) ?? [];
  if (matchesAny(entity, allowed) || matchesAny(entity, optional)) {
    return { classification: 'C_allowed_optional', rationale: 'valid entity; should be in allowed/optional not penalized' };
  }

  const mustHave = (expected.must_have?.entities as string[] | undefined) ?? [];
  if (mustHave.length === 0) {
    return { classification: 'D_fixture_incomplete', rationale: 'no must_have.entities; extra entity penalized by metric' };
  }

  if (testCase.category === 'ambiguous_identity' || testCase.category === 'alias_conflict_real') {
    return { classification: 'E_legitimate_ambiguity', rationale: 'ambiguous identity scenario' };
  }

  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(entity) && mustHave.some((m) => !matchesPattern(entity, m))) {
    return {
      classification: 'D_fixture_incomplete',
      rationale: 'plausible canonical person missing from must_have/allowed',
    };
  }

  return { classification: 'A_fp_compiler', rationale: 'compiled entity not covered by expected contract' };
}

function classifyFalseNegative(
  entity: string,
  expected: CalibrationExpectations,
  compiled: CompiledExtraction,
): { classification: EntityDivergenceClass; rationale: string } {
  const dropped = compiled.droppedArtifacts.filter((d) => d.kind === 'entity');
  const wasDropped = dropped.some((d) => matchesPattern(d.originalRef, entity));
  if (wasDropped) {
    return { classification: 'B_fn_compiler', rationale: 'must_have entity dropped by compiler' };
  }
  return {
    classification: 'F_schema_signal_gap',
    rationale: 'extractor did not supply entity; compiler cannot invent',
  };
}

export function auditEntityPrecision(
  testCase: CalibrationCase,
  extractorOutput: ExtractorOutput,
  compiled: CompiledExtraction,
): EntityAuditRow {
  const expected = testCase.expected;
  const mustHave = (expected.must_have?.entities as string[] | undefined) ?? [];
  const allowed = [
    ...((expected.allowed?.entities as string[] | undefined) ?? []),
    ...((expected.optional?.entities as string[] | undefined) ?? []),
  ];
  const mustNot = (expected.must_not_have?.entities as string[] | undefined) ?? [];

  const compiledNames = compiled.entities.map((e) => e.name);
  const extractorNames = extractorOutput.entities.map((e) => e.name);

  const true_positives: string[] = [];
  const false_positives: string[] = [];
  const false_negatives: string[] = [];
  const divergence_classifications: EntityAuditRow['divergence_classifications'] = [];

  const acceptableForPrecision = [...mustHave, ...allowed];

  for (const name of compiledNames) {
    if (mustNot.some((p) => tokenMatches(name, p))) {
      false_positives.push(name);
      const c = classifyFalsePositive(name, expected, testCase);
      divergence_classifications.push({ entity: name, kind: 'fp', ...c });
    } else if (matchesAny(name, mustHave)) {
      true_positives.push(name);
    } else if (matchesAny(name, allowed)) {
      true_positives.push(name);
    } else if (mustHave.length === 0 && !matchesAny(name, mustNot)) {
      false_positives.push(name);
      const c = classifyFalsePositive(name, expected, testCase);
      divergence_classifications.push({ entity: name, kind: 'fp', ...c });
    } else if (!matchesAny(name, acceptableForPrecision)) {
      false_positives.push(name);
      const c = classifyFalsePositive(name, expected, testCase);
      divergence_classifications.push({ entity: name, kind: 'fp', ...c });
    } else {
      true_positives.push(name);
    }
  }

  for (const required of mustHave) {
    if (!compiledNames.some((n) => matchesPattern(n, required))) {
      false_negatives.push(required);
      const c = classifyFalseNegative(required, expected, compiled);
      divergence_classifications.push({ entity: required, kind: 'fn', ...c });
    }
  }

  const denom = true_positives.length + false_positives.length;
  const scenario_entity_precision = denom > 0 ? true_positives.length / denom : null;

  return {
    scenario_id: testCase.scenario_id,
    category: testCase.category,
    fixture_origin: testCase.fixture_origin,
    raw_content_summary: summarize(testCase.raw_content),
    extractor_entities: extractorNames,
    compiled_entities: compiledNames,
    expected_must_have: mustHave,
    expected_allowed: (expected.allowed?.entities as string[] | undefined) ?? [],
    expected_optional: (expected.optional?.entities as string[] | undefined) ?? [],
    expected_must_not_have: mustNot,
    true_positives,
    false_positives,
    false_negatives,
    divergence_classifications,
    scenario_entity_precision,
  };
}

export function aggregateEntityPrecision(rows: EntityAuditRow[]): number {
  let tp = 0;
  let fp = 0;
  for (const row of rows) {
    const hasEntityContract =
      row.expected_must_have.length > 0 ||
      row.expected_allowed.length > 0 ||
      row.expected_optional.length > 0;
    if (!hasEntityContract) continue;
    tp += row.true_positives.length;
    fp += row.false_positives.length;
  }
  return tp + fp > 0 ? tp / (tp + fp) : 1;
}
