import type { SourceMode } from '../../types/domain.js';
import type { ExtractorOutput } from '../../types/domain.js';

export type FixtureOrigin = 'captured' | 'synthetic';

export interface CalibrationForbiddenOutput {
  type: 'clarification' | 'entity' | 'event' | 'alias';
  match: string;
}

export interface CalibrationExpectations {
  must_have?: Record<string, string[] | number>;
  must_not_have?: Record<string, string[]>;
  forbidden_outputs?: CalibrationForbiddenOutput[];
  allowed?: Record<string, string[]>;
  optional?: Record<string, string[]>;
  exact_match?: Record<string, unknown>;
}

export interface CalibrationCase {
  scenario_id: string;
  category: string;
  raw_content: string;
  source_channel: string;
  source_mode: SourceMode;
  received_at: string;
  timezone: string;
  fixture_origin: FixtureOrigin;
  extractor_version: string;
  captured_at: string;
  extractor_output: ExtractorOutput;
  expected: CalibrationExpectations;
  test_only_fragments?: string[];
}

export interface CalibrationManifest {
  compiler_version: string;
  extractor_version: string;
  schema_version: string;
  prompt_version: string;
  case_count_target: { min: number; max: number };
  thresholds: Record<string, number>;
}

export interface CaseEvaluationResult {
  scenario_id: string;
  category: string;
  passed: boolean;
  failures: string[];
  current: Record<string, unknown>;
  compiled: Record<string, unknown>;
}
