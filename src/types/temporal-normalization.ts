export const TEMPORAL_NORMALIZER_ID = 'temporal-normalizer';
export const TEMPORAL_NORMALIZER_VERSION = '1.0.0';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export type TemporalNormalizationStatus =
  | 'resolved'
  | 'ambiguous'
  | 'not_applicable'
  | 'failed';

export type TemporalPrecision = 'date' | 'datetime' | 'time_only' | 'unknown';

export type DueDateBoundary = 'exact';

export type TemporalReasonCode =
  | 'empty_literal'
  | 'no_temporal_tokens'
  | 'relative_day_resolved'
  | 'weekday_resolved'
  | 'weekday_this_week_resolved'
  | 'weekday_next_week_resolved'
  | 'absolute_date_resolved'
  | 'absolute_datetime_resolved'
  | 'partial_date_inferred_year'
  | 'partial_date_inferred_month'
  | 'missing_date'
  | 'missing_month'
  | 'missing_year'
  | 'impossible_date'
  | 'impossible_time'
  | 'conflicting_tokens'
  | 'vague_expression'
  | 'timezone_invalid'
  | 'missing_temporal_anchor'
  | 'parse_error';

export interface TemporalNormalizationInput {
  literal: string | null | undefined;
  receivedAt: string;
  timezone?: string | null;
  locale?: string;
}

export interface NormalizedTemporalValue {
  literal: string;
  status: TemporalNormalizationStatus;
  precision: TemporalPrecision;
  localDate: string | null;
  localTime: string | null;
  instant: string | null;
  timezone: string;
  timezoneSource: 'envelope' | 'default';
  dueDateBoundary: DueDateBoundary | null;
  implicitYear: boolean;
  implicitMonth: boolean;
  confidence: number;
  reasonCode: TemporalReasonCode;
  reasonDetail: string | null;
  matchedPatternId: string | null;
  normalizerId: typeof TEMPORAL_NORMALIZER_ID;
  normalizerVersion: string;
}
