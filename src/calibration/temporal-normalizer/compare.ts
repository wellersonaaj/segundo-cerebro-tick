import type { NormalizedTemporalValue } from '../../types/temporal-normalization.js';
import { toSemanticSnapshot } from './snapshot.js';
import type { TemporalCaseExpected, TemporalSemanticSnapshot } from './types.js';

function pushDiff(diffs: string[], field: string, expected: unknown, actual: unknown): void {
  if (expected !== actual) {
    diffs.push(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function compareToFixtureExpected(
  expected: TemporalCaseExpected,
  actual: NormalizedTemporalValue,
): { passed: boolean; diff: string[] } {
  const diff: string[] = [];

  if (expected.literal !== undefined) {
    pushDiff(diff, 'literal', expected.literal, actual.literal);
  }
  if (expected.status !== undefined) {
    pushDiff(diff, 'status', expected.status, actual.status);
  }
  if (expected.localDate !== undefined) {
    pushDiff(diff, 'localDate', expected.localDate, actual.localDate);
  }
  if (expected.localTime !== undefined) {
    pushDiff(diff, 'localTime', expected.localTime, actual.localTime);
  }
  if (expected.instant !== undefined) {
    pushDiff(diff, 'instant', expected.instant, actual.instant);
  }
  if (expected.instantPresent === true) {
    if (actual.instant == null) {
      diff.push('instant: expected non-null');
    } else if (!/^\d{4}-\d{2}-\d{2}T/.test(actual.instant)) {
      diff.push(`instant: expected ISO datetime, got ${JSON.stringify(actual.instant)}`);
    }
  }
  if (expected.instantContains !== undefined) {
    pushDiff(diff, 'instant', expected.instantContains, actual.instant);
  }
  if (expected.precision !== undefined) {
    pushDiff(diff, 'precision', expected.precision, actual.precision);
  }
  if (expected.reasonCode !== undefined) {
    pushDiff(diff, 'reasonCode', expected.reasonCode, actual.reasonCode);
  }
  if (expected.matchedPatternId !== undefined) {
    pushDiff(diff, 'matchedPatternId', expected.matchedPatternId, actual.matchedPatternId);
  }
  if (expected.timezone !== undefined) {
    pushDiff(diff, 'timezone', expected.timezone, actual.timezone);
  }
  if (expected.timezoneSource !== undefined) {
    pushDiff(diff, 'timezoneSource', expected.timezoneSource, actual.timezoneSource);
  }
  if (expected.dueDateBoundary !== undefined) {
    pushDiff(diff, 'dueDateBoundary', expected.dueDateBoundary, actual.dueDateBoundary);
  }
  if (expected.implicitYear !== undefined) {
    pushDiff(diff, 'implicitYear', expected.implicitYear, actual.implicitYear);
  }
  if (expected.implicitMonth !== undefined) {
    pushDiff(diff, 'implicitMonth', expected.implicitMonth, actual.implicitMonth);
  }
  if (expected.normalizerId !== undefined) {
    pushDiff(diff, 'normalizerId', expected.normalizerId, actual.normalizerId);
  }
  if (expected.normalizerVersion !== undefined) {
    pushDiff(diff, 'normalizerVersion', expected.normalizerVersion, actual.normalizerVersion);
  }

  return { passed: diff.length === 0, diff };
}

const SEMANTIC_FIELDS: (keyof TemporalSemanticSnapshot)[] = [
  'status',
  'precision',
  'localDate',
  'localTime',
  'instant',
  'timezone',
  'timezoneSource',
  'dueDateBoundary',
  'implicitYear',
  'implicitMonth',
  'reasonCode',
  'matchedPatternId',
  'normalizerVersion',
];

export function compareToBaselineSnapshot(
  baseline: TemporalSemanticSnapshot,
  actual: NormalizedTemporalValue,
): { passed: boolean; diff: string[] } {
  const snapshot = toSemanticSnapshot(actual);
  const diff: string[] = [];

  for (const field of SEMANTIC_FIELDS) {
    pushDiff(diff, field, baseline[field], snapshot[field]);
  }

  return { passed: diff.length === 0, diff };
}
