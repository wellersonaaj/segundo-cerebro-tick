import { describe, expect, it } from 'vitest';
import {
  applyBootstrapAssertionReview,
  BOOTSTRAP_MAX_ASSERTIONS,
  mergeBootstrapAssertionReview,
} from '../src/services/bootstrap-assertion-review.js';
import type { ExtractorOutput } from '../src/types/domain.js';

function baseOutput(assertionCount: number): ExtractorOutput {
  return {
    schema_version: '1.3',
    inbox_item_id: 'x',
    events: [],
    entities: [],
    assertions: Array.from({ length: assertionCount }, (_, i) => ({
      assertion_type: 'fact',
      content: `fact ${i}`,
      status: 'unverified',
      source_excerpt: 'x',
      confidence: 0.9,
    })),
    tasks: [],
    clarification_requests: [],
    requires_review: false,
    review_reasons: [],
    processing_notes: [],
  };
}

describe('bootstrap assertion review', () => {
  it('adds completeness note for bootstrap without requires_review', () => {
    const review = applyBootstrapAssertionReview('bootstrap', baseOutput(15));
    expect(review.processing_notes.some((n) => n.includes('bootstrap_assertion_completeness_review'))).toBe(
      true,
    );
    expect(review.requires_review).toBe(false);
  });

  it('flags possible_assertion_truncation at safety ceiling', () => {
    const review = applyBootstrapAssertionReview('bootstrap', baseOutput(BOOTSTRAP_MAX_ASSERTIONS));
    expect(review.requires_review).toBe(true);
    expect(review.review_reasons).toContain('possible_assertion_truncation');
  });

  it('does nothing for non-bootstrap channels', () => {
    const review = applyBootstrapAssertionReview('web', baseOutput(100));
    expect(review.processing_notes).toHaveLength(0);
  });

  it('mergeBootstrapAssertionReview appends notes', () => {
    const output = baseOutput(5);
    const merged = mergeBootstrapAssertionReview(
      output,
      applyBootstrapAssertionReview('bootstrap', output),
    );
    expect(merged.processing_notes.length).toBeGreaterThan(0);
  });
});
