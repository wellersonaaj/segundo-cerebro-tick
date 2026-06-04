import type { NormalizedTemporalValue } from './temporal-normalization.js';

export type ArtifactRecordStatusV2 = 'candidate' | 'active' | 'superseded' | 'rejected';
export type RegistryStatusV2 = 'candidate' | 'active' | 'superseded' | 'rejected';
export type ExtractionRunStatusV2 = 'started' | 'validated' | 'promoted' | 'failed' | 'discarded';
export type ClarificationMaterialityV2 = 'blocking' | 'non_blocking';
export type TaskStatusV2 = 'open' | 'done' | 'cancelled' | 'blocked';

export interface DueAtColumnsV2 {
  due_at_literal: string;
  due_at_local_date: string | null;
  due_at_local_time: string | null;
  due_at_instant: string | null;
  due_at_timezone: string;
  due_at_timezone_source: 'envelope' | 'default' | null;
  due_at_precision: string | null;
  due_at_status: string | null;
  due_at_reason_code: string | null;
  due_at_normalizer_id: string | null;
  due_at_normalizer_version: string | null;
  due_at_implicit_year: boolean | null;
  due_at_implicit_month: boolean | null;
  due_at_evidence: Record<string, unknown> | null;
}

export function dueAtColumnsFromTemporal(
  temporal: NormalizedTemporalValue | null | undefined,
  fallbackLiteral?: string | null,
): DueAtColumnsV2 {
  if (!temporal) {
    return {
      due_at_literal: fallbackLiteral ?? '',
      due_at_local_date: null,
      due_at_local_time: null,
      due_at_instant: null,
      due_at_timezone: 'America/Sao_Paulo',
      due_at_timezone_source: null,
      due_at_precision: null,
      due_at_status: null,
      due_at_reason_code: null,
      due_at_normalizer_id: null,
      due_at_normalizer_version: null,
      due_at_implicit_year: null,
      due_at_implicit_month: null,
      due_at_evidence: null,
    };
  }
  return {
    due_at_literal: temporal.literal,
    due_at_local_date: temporal.localDate,
    due_at_local_time: temporal.localTime,
    due_at_instant: temporal.instant,
    due_at_timezone: temporal.timezone,
    due_at_timezone_source: temporal.timezoneSource,
    due_at_precision: temporal.precision,
    due_at_status: temporal.status,
    due_at_reason_code: temporal.reasonCode,
    due_at_normalizer_id: temporal.normalizerId,
    due_at_normalizer_version: temporal.normalizerVersion,
    due_at_implicit_year: temporal.implicitYear,
    due_at_implicit_month: temporal.implicitMonth,
    due_at_evidence: temporal as unknown as Record<string, unknown>,
  };
}

export interface ExtractionRunV2 {
  id: string;
  inbox_item_id: string;
  correction_id: string | null;
  trigger_type: string | null;
  status: ExtractionRunStatusV2;
  schema_version: string;
  prompt_version: string;
  extractor_version: string;
  model_name: string;
  normalizer_version: string;
  compiler_version: string;
  input_content_hash: string | null;
  raw_model_output: string | null;
  parsed_output: Record<string, unknown> | null;
  compiled_output: Record<string, unknown> | null;
  validation_errors: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface TaskMutationV2 {
  id: string;
  task_id: string | null;
  inbox_item_id: string;
  extraction_run_id: string;
  operation: string;
  task_reference: string | null;
  record_status: ArtifactRecordStatusV2;
  created_at: string;
}

export interface PersistenceV2Result {
  entityIds: Map<string, string>;
  eventIds: string[];
  assertionIds: string[];
  taskMutationIds: string[];
  clarificationIds: string[];
  aliasEvidenceIds: string[];
}
