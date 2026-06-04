import type { TemporalReasonCode } from '../../types/temporal-normalization.js';

const CONFIDENCE_BY_REASON: Record<TemporalReasonCode, number> = {
  empty_literal: 0,
  no_temporal_tokens: 0,
  relative_day_resolved: 0.95,
  weekday_resolved: 0.9,
  weekday_this_week_resolved: 0.85,
  weekday_next_week_resolved: 0.9,
  absolute_date_resolved: 0.98,
  absolute_datetime_resolved: 0.98,
  partial_date_inferred_year: 0.8,
  partial_date_inferred_month: 0.75,
  missing_date: 0.2,
  missing_month: 0.2,
  missing_year: 0.2,
  impossible_date: 0,
  impossible_time: 0,
  conflicting_tokens: 0.15,
  vague_expression: 0.25,
  timezone_invalid: 0,
  missing_temporal_anchor: 0,
  parse_error: 0,
};

export function confidenceForReason(reasonCode: TemporalReasonCode): number {
  return CONFIDENCE_BY_REASON[reasonCode];
}
