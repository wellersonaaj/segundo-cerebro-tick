import type { CompiledExtraction } from '../../types/memory-compiler.js';
import type { CalibrationCase, CaseEvaluationResult } from './types.js';
import type { ExtractorOutput } from '../../types/domain.js';

export interface CalibrationMetrics {
  entity_precision: number;
  entity_false_positive_rate: number;
  alias_as_entity_rate: number;
  event_precision: number;
  preference_to_event_rate: number;
  false_clarification_rate: number;
  negation_error_rate: number;
  description_corruption_rate: number;
  task_recall: number;
}

export interface MetricsAccumulator {
  entityTp: number;
  entityFp: number;
  entityTotal: number;
  aliasAsEntity: number;
  eventTp: number;
  eventTotal: number;
  preferenceEvents: number;
  preferenceTexts: number;
  falseClarifications: number;
  totalClarifications: number;
  negationErrors: number;
  negationCases: number;
  descriptionCorruptions: number;
  taskExpected: number;
  taskFound: number;
}

export function createAccumulator(): MetricsAccumulator {
  return {
    entityTp: 0,
    entityFp: 0,
    entityTotal: 0,
    aliasAsEntity: 0,
    eventTp: 0,
    eventTotal: 0,
    preferenceEvents: 0,
    preferenceTexts: 0,
    falseClarifications: 0,
    totalClarifications: 0,
    negationErrors: 0,
    negationCases: 0,
    descriptionCorruptions: 0,
    taskExpected: 0,
    taskFound: 0,
  };
}

export function accumulateMetrics(
  acc: MetricsAccumulator,
  testCase: CalibrationCase,
  current: ExtractorOutput,
  compiled: CompiledExtraction,
  evaluation: CaseEvaluationResult,
): void {
  const mustHave = (testCase.expected.must_have?.entities as string[] | undefined) ?? [];
  const allowed = [
    ...((testCase.expected.allowed?.entities as string[] | undefined) ?? []),
    ...((testCase.expected.optional?.entities as string[] | undefined) ?? []),
  ];
  const mustNot = (testCase.expected.must_not_have?.entities as string[] | undefined) ?? [];
  const compiledNames = compiled.entities.map((e) => e.name.toLowerCase());

  const matches = (name: string, patterns: string[]) =>
    patterns.some((p) => {
      const n = name.toLowerCase();
      const pl = p.toLowerCase();
      if (n === pl || n.split(/\s+/).includes(pl)) return true;
      if (pl.length >= 5 && n.includes(pl)) return true;
      return false;
    });

  const mustNotMatch = (name: string, patterns: string[]) =>
    patterns.some((p) => {
      const n = name.toLowerCase();
      const pl = p.toLowerCase();
      return n === pl || n.split(/\s+/).includes(pl);
    });

  const hasEntityContract = mustHave.length > 0 || allowed.length > 0;

  if (hasEntityContract) {
    for (const name of compiled.entities.map((e) => e.name)) {
      if (mustNotMatch(name, mustNot)) {
        acc.entityTotal += 1;
        acc.entityFp += 1;
        continue;
      }
      if (matches(name, mustHave) || matches(name, allowed)) {
        acc.entityTotal += 1;
        acc.entityTp += 1;
      } else if (mustHave.length > 0) {
        acc.entityTotal += 1;
        acc.entityFp += 1;
      }
    }
  }

  for (const e of current.entities) {
    const isAlias = compiled.aliases.some((a) => a.alias.toLowerCase() === e.name.toLowerCase());
    if (isAlias && compiledNames.includes(e.name.toLowerCase())) {
      acc.aliasAsEntity += 1;
    }
  }

  const expectedEvents = (testCase.expected.must_have?.events as string[] | undefined) ?? [];
  acc.eventTotal += compiled.events.length;
  for (const ev of compiled.events) {
    if (expectedEvents.length === 0 && testCase.expected.must_not_have?.events) {
      acc.eventTp += 0;
    } else if (expectedEvents.some((x) => ev.eventType.includes(x) || ev.description.includes(x))) {
      acc.eventTp += 1;
    }
  }
  if (expectedEvents.length === 0 && compiled.events.length === 0 && testCase.expected.must_not_have?.events) {
    acc.eventTp += 1;
    acc.eventTotal = Math.max(acc.eventTotal, 1);
  }

  if (/prefere|preferência/i.test(testCase.raw_content)) {
    acc.preferenceTexts += 1;
    if (compiled.events.length > 0) acc.preferenceEvents += 1;
  }

  acc.totalClarifications += compiled.clarificationCandidates.length;
  if (evaluation.failures.some((f) => f.includes('forbidden_outputs'))) {
    acc.falseClarifications += 1;
  }

  if ((testCase.expected.forbidden_outputs?.length ?? 0) > 0) {
    acc.negationCases += 1;
    if (evaluation.failures.some((f) => f.includes('forbidden_outputs'))) {
      acc.negationErrors += 1;
    }
  }

  if (compiled.compilerNotes.some((n) => n.includes('title entity list'))) {
    acc.descriptionCorruptions += 1;
  }

  const expectedTasks = (testCase.expected.must_have?.tasks as string[] | undefined) ?? [];
  acc.taskExpected += expectedTasks.length;
  for (const t of expectedTasks) {
    if (compiled.tasks.some((ct) => ct.title.toLowerCase().includes(t.toLowerCase()))) {
      acc.taskFound += 1;
    }
  }
}

export function finalizeMetrics(acc: MetricsAccumulator): CalibrationMetrics {
  const eventPrecisionRaw = acc.eventTotal > 0 ? acc.eventTp / acc.eventTotal : 1;
  return {
    entity_precision: acc.entityTotal > 0 ? acc.entityTp / acc.entityTotal : 1,
    entity_false_positive_rate: acc.entityTotal > 0 ? acc.entityFp / acc.entityTotal : 0,
    alias_as_entity_rate: acc.entityTotal > 0 ? acc.aliasAsEntity / acc.entityTotal : 0,
    event_precision: Math.min(1, eventPrecisionRaw),
    preference_to_event_rate: acc.preferenceTexts > 0 ? acc.preferenceEvents / acc.preferenceTexts : 0,
    false_clarification_rate:
      acc.totalClarifications > 0 ? acc.falseClarifications / acc.totalClarifications : 0,
    negation_error_rate: acc.negationCases > 0 ? acc.negationErrors / acc.negationCases : 0,
    description_corruption_rate: acc.descriptionCorruptions > 0 ? 1 : 0,
    task_recall: acc.taskExpected > 0 ? acc.taskFound / acc.taskExpected : 1,
  };
}

export function checkThresholds(
  metrics: CalibrationMetrics,
  thresholds: Record<string, number>,
  bootstrapEntityPrecision: number,
): string[] {
  const failures: string[] = [];
  if (metrics.alias_as_entity_rate > (thresholds.alias_as_entity_rate ?? 0)) {
    failures.push(`alias_as_entity_rate ${metrics.alias_as_entity_rate} > ${thresholds.alias_as_entity_rate}`);
  }
  if (metrics.preference_to_event_rate > (thresholds.preference_to_event_rate ?? 0)) {
    failures.push(`preference_to_event_rate ${metrics.preference_to_event_rate}`);
  }
  if (metrics.description_corruption_rate > (thresholds.description_corruption_rate ?? 0)) {
    failures.push(`description_corruption_rate ${metrics.description_corruption_rate}`);
  }
  if (metrics.negation_error_rate > (thresholds.negation_error_rate ?? 0)) {
    failures.push(`negation_error_rate ${metrics.negation_error_rate}`);
  }
  if (metrics.event_precision < (thresholds.event_precision ?? 0.9)) {
    failures.push(`event_precision ${metrics.event_precision} < ${thresholds.event_precision}`);
  }
  if (metrics.entity_precision < (thresholds.entity_precision ?? 0.95)) {
    failures.push(`entity_precision ${metrics.entity_precision} < ${thresholds.entity_precision}`);
  }
  if (bootstrapEntityPrecision < (thresholds.entity_precision_bootstrap ?? 0.95)) {
    failures.push(`bootstrap entity_precision ${bootstrapEntityPrecision}`);
  }
  if (metrics.false_clarification_rate > (thresholds.false_clarification_rate ?? 0.05)) {
    failures.push(`false_clarification_rate ${metrics.false_clarification_rate}`);
  }
  return failures;
}
