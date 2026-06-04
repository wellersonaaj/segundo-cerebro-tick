import type { CompiledExtraction } from '../../types/memory-compiler.js';
import type { CalibrationCase, CalibrationExpectations, CaseEvaluationResult } from './types.js';
import type { ExtractorOutput } from '../../types/domain.js';
import { viewForEvaluation } from './build-current-output.js';

function compiledView(compiled: CompiledExtraction): Record<string, string[]> {
  return {
    entities: compiled.entities.map((e) => e.name),
    events: compiled.events.map((e) => e.eventType),
    event_descriptions: compiled.events.map((e) => e.description),
    aliases: compiled.aliases.map((a) => a.alias),
    alias_targets: compiled.aliases.map((a) => a.targetEntityName),
    tasks: compiled.tasks.map((t) => t.title),
    clarifications: compiled.clarificationCandidates.map((c) => c.question),
    assertions: compiled.assertions.map((a) => a.content),
    assertion_statuses: compiled.assertions.map((a) => a.status),
  };
}

function listIncludes(haystack: string[], needles: string[]): boolean {
  const normHay = haystack.map((h) => h.toLowerCase());
  return needles.every((n) => {
    const needle = n.toLowerCase();
    return normHay.some(
      (h) =>
        h.includes(needle) ||
        needle.includes(h) ||
        h.replace(/ção/g, 'cao').includes(needle.replace(/ção/g, 'cao')),
    );
  });
}

function listExcludes(haystack: string[], forbidden: string[]): boolean {
  const normHay = haystack.map((h) => h.toLowerCase());
  return forbidden.every((f) => {
    const needle = f.toLowerCase();
    return !normHay.some((h) => h === needle || h.split(/\s+/).includes(needle));
  });
}

function evaluateExpectations(
  view: Record<string, string[]>,
  expected: CalibrationExpectations,
  label: string,
): string[] {
  const failures: string[] = [];

  for (const [key, values] of Object.entries(expected.must_have ?? {})) {
    const arr = values as string[];
    const actual = view[key] ?? [];
    if (!listIncludes(actual, arr)) {
      failures.push(`${label}: must_have.${key} missing ${JSON.stringify(arr)} in ${JSON.stringify(actual)}`);
    }
  }

  for (const [key, values] of Object.entries(expected.must_not_have ?? {})) {
    const arr = values as string[];
    const actual = view[key] ?? [];
    if (!listExcludes(actual, arr)) {
      failures.push(`${label}: must_not_have.${key} includes forbidden ${JSON.stringify(arr)}`);
    }
  }

  for (const forbidden of expected.forbidden_outputs ?? []) {
    const match = forbidden.match.toLowerCase();
    if (forbidden.type === 'clarification') {
      const clarifications = view.clarifications ?? [];
      if (clarifications.some((q) => q.toLowerCase().includes(match))) {
        failures.push(`${label}: forbidden_outputs clarification matched "${forbidden.match}"`);
      }
      continue;
    }
    if (forbidden.type === 'entity') {
      const entities = view.entities ?? [];
      if (entities.some((e) => e.toLowerCase() === match || e.toLowerCase().startsWith(match))) {
        failures.push(`${label}: forbidden_outputs entity matched "${forbidden.match}"`);
      }
      continue;
    }
    if (forbidden.type === 'event') {
      const desc = view.event_descriptions ?? [];
      if (desc.some((d) => d.toLowerCase().includes(match))) {
        failures.push(`${label}: forbidden_outputs event matched "${forbidden.match}"`);
      }
      continue;
    }
    const blob = JSON.stringify(view).toLowerCase();
    if (blob.includes(match)) {
      failures.push(`${label}: forbidden_outputs matched "${forbidden.match}"`);
    }
  }

  if (expected.exact_match) {
    for (const [key, value] of Object.entries(expected.exact_match)) {
      const actual = view[key];
      if (JSON.stringify(actual) !== JSON.stringify(value)) {
        failures.push(`${label}: exact_match.${key} expected ${JSON.stringify(value)} got ${JSON.stringify(actual)}`);
      }
    }
  }

  return failures;
}

export function evaluateCase(
  testCase: CalibrationCase,
  current: ExtractorOutput,
  compiled: CompiledExtraction,
): CaseEvaluationResult {
  const failures: string[] = [];
  const currentView = viewForEvaluation(current);
  const compiledViewData = compiledView(compiled);

  failures.push(...evaluateExpectations(compiledViewData, testCase.expected, 'compiled'));

  return {
    scenario_id: testCase.scenario_id,
    category: testCase.category,
    passed: failures.length === 0,
    failures,
    current: currentView,
    compiled: compiledViewData,
  };
}
