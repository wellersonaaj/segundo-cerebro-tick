import { describe, expect, it } from 'vitest';
import {
  aggregateClassifications,
  classifyAuditRow,
} from '../src/calibration/extractor-v1.4/audit-detail.js';

describe('classifyAuditRow', () => {
  it('classifies alias category with fox entity as schema gap', () => {
    const result = classifyAuditRow({
      category: 'alias_reassignment',
      evaluation_failures: ['compiled: must_have.alias_targets missing ["Pat Lee"] in []'],
      evaluation_passed: false,
      entity_precision: 0.55,
      false_positives: ['Codinome Fox-1'],
      false_negatives: [],
      entity_audit_notes: [],
      extractor_summary: {
        entity_names: ['Codinome Fox-1', 'Pat Lee'],
        entity_aliases_inline: [],
        event_types: ['assignment'],
        event_descriptions: [],
        clarification_count: 1,
        assertion_count: 1,
        has_review_flags: true,
      },
      expected: { must_have: { alias_targets: ['Pat Lee'] } },
    });
    expect(result.classification).toBe('C_schema_signal_gap');
  });

  it('classifies entity_precision 0 with only alias_targets as metric error', () => {
    const result = classifyAuditRow({
      category: 'alias_negation',
      evaluation_failures: [],
      evaluation_passed: false,
      entity_precision: 0,
      false_positives: ['Gabriel Nova', 'Helcio Zeta'],
      false_negatives: [],
      entity_audit_notes: [],
      extractor_summary: {
        entity_names: ['Gabriel Nova', 'Helcio Zeta'],
        entity_aliases_inline: [],
        event_types: [],
        event_descriptions: [],
        clarification_count: 0,
        assertion_count: 0,
        has_review_flags: false,
      },
      expected: { must_have: { alias_targets: ['Gabriel Nova'] } },
    });
    expect(result.classification).toBe('F_metric_or_label_error');
  });
});

describe('aggregateClassifications', () => {
  it('sums classifications', () => {
    const counts = aggregateClassifications([
      { classification: 'C_schema_signal_gap' } as never,
      { classification: 'C_schema_signal_gap' } as never,
      { classification: 'A_compiler_deterministic' } as never,
    ]);
    expect(counts.C_schema_signal_gap).toBe(2);
    expect(counts.A_compiler_deterministic).toBe(1);
  });
});
