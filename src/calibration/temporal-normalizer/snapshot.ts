import type { NormalizedTemporalValue } from '../../types/temporal-normalization.js';
import type { TemporalSemanticSnapshot } from './types.js';

export function toSemanticSnapshot(value: NormalizedTemporalValue): TemporalSemanticSnapshot {
  return {
    status: value.status,
    precision: value.precision,
    localDate: value.localDate,
    localTime: value.localTime,
    instant: value.instant,
    timezone: value.timezone,
    timezoneSource: value.timezoneSource,
    dueDateBoundary: value.dueDateBoundary,
    implicitYear: value.implicitYear,
    implicitMonth: value.implicitMonth,
    reasonCode: value.reasonCode,
    matchedPatternId: value.matchedPatternId,
    normalizerVersion: value.normalizerVersion,
  };
}
