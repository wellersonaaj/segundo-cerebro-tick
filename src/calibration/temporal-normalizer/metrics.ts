import type { NormalizedTemporalValue, TemporalNormalizationStatus } from '../../types/temporal-normalization.js';
import {
  TEMPORAL_NORMALIZER_ID,
  TEMPORAL_NORMALIZER_VERSION,
} from '../../types/temporal-normalization.js';
import type { TemporalCalibrationReport, CaseComparisonFailure } from './types.js';

function bump(map: Record<string, number>, key: string | null | undefined): void {
  const k = key ?? '(null)';
  map[k] = (map[k] ?? 0) + 1;
}

function confidenceBucket(confidence: number): string {
  if (confidence >= 0.95) return '0.95-1.00';
  if (confidence >= 0.85) return '0.85-0.94';
  if (confidence >= 0.75) return '0.75-0.84';
  if (confidence > 0) return '0.01-0.74';
  return '0.00';
}

export function buildCalibrationReport(params: {
  results: NormalizedTemporalValue[];
  failures: CaseComparisonFailure[];
  compareMode: 'fixtures' | 'baseline';
  baselineVersion?: string;
  semanticDiffCount?: number;
}): TemporalCalibrationReport {
  const { results, failures, compareMode, baselineVersion, semanticDiffCount } = params;
  const totalCases = results.length;
  const failedCases = failures.length;
  const passedCases = totalCases - failedCases;

  const statusCounts: Record<TemporalNormalizationStatus, number> = {
    resolved: 0,
    ambiguous: 0,
    not_applicable: 0,
    failed: 0,
  };

  const patternCounts: Record<string, number> = {};
  const timezoneSourceCounts: Record<string, number> = {};
  const reasonCodeCounts: Record<string, number> = {};
  const confidenceDistribution: Record<string, number> = {};

  let implicitYearCount = 0;
  let implicitMonthCount = 0;
  let timezoneInvalidCount = 0;
  let timezoneDefaultCount = 0;

  for (const r of results) {
    statusCounts[r.status] += 1;
    bump(patternCounts, r.matchedPatternId);
    bump(timezoneSourceCounts, r.timezoneSource);
    bump(reasonCodeCounts, r.reasonCode);
    bump(confidenceDistribution, confidenceBucket(r.confidence));
    if (r.implicitYear) implicitYearCount += 1;
    if (r.implicitMonth) implicitMonthCount += 1;
    if (r.reasonCode === 'timezone_invalid') timezoneInvalidCount += 1;
    if (r.timezoneSource === 'default') timezoneDefaultCount += 1;
  }

  return {
    normalizerId: TEMPORAL_NORMALIZER_ID,
    normalizerVersion: TEMPORAL_NORMALIZER_VERSION,
    executedAt: new Date().toISOString(),
    totalCases,
    passedCases,
    failedCases,
    passRate: totalCases === 0 ? 1 : passedCases / totalCases,
    statusCounts,
    patternCounts,
    timezoneSourceCounts,
    reasonCodeCounts,
    confidenceDistribution,
    implicitYearCount,
    implicitMonthCount,
    timezoneInvalidCount,
    timezoneDefaultCount,
    failures,
    compareMode,
    baselineVersion,
    semanticDiffCount,
  };
}
