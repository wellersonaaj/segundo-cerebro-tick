/**
 * Ratio helper for calibration metrics.
 * When denominator is zero the metric is not applicable (null), not 1.
 */

export interface MetricRatioResult {
  value: number | null;
  applicable_runs: number;
  status: 'ok' | 'not_applicable';
}

export function metricRatio(numerator: number, denominator: number): MetricRatioResult {
  if (denominator === 0) {
    return { value: null, applicable_runs: 0, status: 'not_applicable' };
  }
  return {
    value: Math.round((numerator / denominator) * 1000) / 1000,
    applicable_runs: denominator,
    status: 'ok',
  };
}

/** Legacy single-number ratio; prefer metricRatio for gate checks. */
export function ratioOrNull(numerator: number, denominator: number): number | null {
  return metricRatio(numerator, denominator).value;
}
