import type { TaskOperation } from '../../openai/extractor-v1.4.types.js';
import type { CompilerDecisionStatus } from '../../types/memory-compiler-v2.js';
import type { CalibrationRegime } from '../../types/ingestion-context.js';
import type {
  TemporalNormalizationStatus,
  TemporalPrecision,
} from '../../types/temporal-normalization.js';

export interface DueAtTemporalExpectation {
  status?: TemporalNormalizationStatus;
  localDate?: string | null;
  precision?: TemporalPrecision;
  instantPresent?: boolean;
  instantNull?: boolean;
  reasonCode?: string;
  normalizerVersion?: string;
}

export interface V14CalibrationExpectations {
  regime?: CalibrationRegime;
  must_have?: {
    event_kinds?: string[];
    alias_targets?: string[];
    assertion_kinds?: string[];
    task_operations?: TaskOperation[];
    clarification_issue_types?: string[];
    context_resolution?: 'auto' | 'ambiguous';
  };
  must_not_have?: {
    event_kinds?: string[];
    entity_mentions?: string[];
    alias_labels?: string[];
    blocking_clarification_issue_types?: string[];
  };
  decision?: CompilerDecisionStatus;
  min_clarifications?: number;
  due_at_temporal?: DueAtTemporalExpectation;
}

export const FIXED_CALIBRATION_EXPECTATIONS: Record<string, V14CalibrationExpectations> = {
  'v14-panorama-static': {
    must_have: { alias_targets: ['Alex Costa'] },
    must_not_have: { event_kinds: ['meeting', 'confirmation'] },
    decision: 'accepted',
  },
  'v14-static-preferences': {
    must_have: { assertion_kinds: ['opinion'] },
    must_not_have: { event_kinds: ['meeting'] },
    decision: 'accepted',
  },
  'v14-alias-explicit': {
    must_have: { alias_targets: ['Alex Costa'] },
    must_not_have: { entity_mentions: ['Tick'] },
    decision: 'accepted',
  },
  'v14-alias-negated': {
    must_have: { alias_targets: ['Gabriel Nova'] },
    decision: 'accepted',
  },
  'v14-alias-reassignment': {
    must_have: { alias_targets: ['Pat Lee'] },
    must_not_have: { entity_mentions: ['Fox-1'] },
    decision: 'accepted',
  },
  'v14-meeting': {
    must_have: { event_kinds: ['meeting'] },
    decision: 'accepted',
  },
  'v14-confirmation': {
    must_have: { event_kinds: ['confirmation'] },
    decision: 'accepted',
  },
  'v14-correction-participant': {
    must_have: { event_kinds: ['meeting'] },
    decision: 'accepted',
  },
  'v14-correction-sender': {
    must_have: { event_kinds: ['document_sent'] },
    decision: 'accepted',
  },
  'v14-task-open': {
    must_have: { task_operations: ['create'] },
    decision: 'accepted',
  },
  'v14-task-blocked': {
    must_have: { task_operations: ['update_blocker'] },
    decision: 'accepted',
  },
  'v14-task-due-date-change': {
    must_have: { task_operations: ['update_due_date'] },
    decision: 'accepted',
    due_at_temporal: {
      status: 'resolved',
      precision: 'date',
      localDate: '2026-06-08',
      instantNull: true,
      normalizerVersion: '1.0.0',
    },
  },
  'v14-task-assignee-change': {
    must_have: { task_operations: ['update_assignee'] },
    decision: 'accepted',
  },
  'v14-task-completed': {
    must_have: { task_operations: ['complete'] },
    decision: 'accepted',
  },
  'v14-task-cancel': {
    must_have: { task_operations: ['cancel'] },
    decision: 'accepted',
  },
  'v14-project-status': {
    must_have: { assertion_kinds: ['status_update'] },
    decision: 'accepted',
  },
  'v14-ambiguous-identity': {
    min_clarifications: 1,
    decision: 'needs_clarification',
  },
  'v14-fc-task-new': {
    regime: 'first_contact',
    must_have: { task_operations: ['create'] },
    must_not_have: { blocking_clarification_issue_types: ['missing_assignee'] },
    decision: 'accepted',
  },
  'v14-fc-project-new': {
    regime: 'first_contact',
    must_have: { task_operations: ['create'] },
    decision: 'accepted',
  },
  'v14-fc-status-new': {
    regime: 'first_contact',
    must_have: { assertion_kinds: ['status_update'] },
    decision: 'accepted',
  },
  'v14-fc-blocked-new': {
    regime: 'first_contact',
    must_have: { task_operations: ['update_blocker'] },
    decision: 'accepted',
  },
  'v14-ctx-due-date-unique': {
    regime: 'incremental_single',
    must_have: { task_operations: ['update_due_date'], context_resolution: 'auto' },
    decision: 'accepted',
    due_at_temporal: {
      status: 'resolved',
      precision: 'date',
      localDate: '2026-06-05',
      instantNull: true,
    },
  },
  'v14-ctx-assignee-unique': {
    regime: 'incremental_single',
    must_have: { task_operations: ['update_assignee'], context_resolution: 'auto' },
    decision: 'accepted',
  },
  'v14-ctx-complete-unique': {
    regime: 'incremental_single',
    must_have: { task_operations: ['complete'], context_resolution: 'auto' },
    decision: 'accepted',
  },
  'v14-ctx-due-date-ambiguous': {
    regime: 'incremental_ambiguous',
    must_have: { task_operations: ['update_due_date'], context_resolution: 'ambiguous' },
    min_clarifications: 1,
    decision: 'needs_clarification',
  },
};
