import type {
  NormalizedTemporalValue,
  TemporalNormalizationInput,
  TemporalNormalizationStatus,
} from '../../types/temporal-normalization.js';

export interface TemporalCaseExpected {
  status?: TemporalNormalizationStatus;
  localDate?: string | null;
  localTime?: string | null;
  instant?: string | null;
  instantPresent?: boolean;
  instantContains?: string;
  precision?: NormalizedTemporalValue['precision'];
  reasonCode?: NormalizedTemporalValue['reasonCode'];
  matchedPatternId?: string | null;
  timezone?: string;
  timezoneSource?: NormalizedTemporalValue['timezoneSource'];
  dueDateBoundary?: NormalizedTemporalValue['dueDateBoundary'];
  implicitYear?: boolean;
  implicitMonth?: boolean;
  literal?: string;
  normalizerId?: string;
  normalizerVersion?: string;
}

export interface TemporalCalibrationCase {
  id: string;
  input: TemporalNormalizationInput;
  expected: TemporalCaseExpected;
}

export interface TemporalSemanticSnapshot {
  status: TemporalNormalizationStatus;
  precision: NormalizedTemporalValue['precision'];
  localDate: string | null;
  localTime: string | null;
  instant: string | null;
  timezone: string;
  timezoneSource: NormalizedTemporalValue['timezoneSource'];
  dueDateBoundary: NormalizedTemporalValue['dueDateBoundary'];
  implicitYear: boolean;
  implicitMonth: boolean;
  reasonCode: NormalizedTemporalValue['reasonCode'];
  matchedPatternId: string | null;
  normalizerVersion: string;
}

export interface TemporalBaselineCase {
  case_id: string;
  input: {
    literal: string;
    receivedAt: string;
    timezone?: string | null;
  };
  snapshot: TemporalSemanticSnapshot;
}

export interface TemporalBaselineFile {
  normalizerId: string;
  normalizerVersion: string;
  frozenAt: string;
  cases: TemporalBaselineCase[];
}

export interface CaseComparisonFailure {
  case_id: string;
  input: TemporalNormalizationInput;
  expected: TemporalCaseExpected | TemporalSemanticSnapshot;
  actual: NormalizedTemporalValue;
  diff: string[];
}

export interface TemporalCalibrationReport {
  normalizerId: string;
  normalizerVersion: string;
  executedAt: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  statusCounts: Record<TemporalNormalizationStatus, number>;
  patternCounts: Record<string, number>;
  timezoneSourceCounts: Record<string, number>;
  reasonCodeCounts: Record<string, number>;
  confidenceDistribution: Record<string, number>;
  implicitYearCount: number;
  implicitMonthCount: number;
  timezoneInvalidCount: number;
  timezoneDefaultCount: number;
  failures: CaseComparisonFailure[];
  compareMode: 'fixtures' | 'baseline';
  baselineVersion?: string;
  semanticDiffCount?: number;
}
