import { describe, expect, it } from 'vitest';
import {
  filterVariationsByCategories,
  hashExtractorShape,
  LIVE_VARIATIONS,
} from '../src/calibration/compiler-v1/live-capture.js';

describe('live-capture', () => {
  it('filters variations by category', () => {
    const filtered = filterVariationsByCategories(['alias_reassignment', 'episodic_meeting']);
    expect(filtered.length).toBe(2);
    expect(filtered.every((v) => ['alias_reassignment', 'episodic_meeting'].includes(v.category))).toBe(true);
  });

  it('has 8 synthetic variation categories', () => {
    const cats = new Set(LIVE_VARIATIONS.map((v) => v.category));
    expect(cats.size).toBe(8);
  });

  it('hashExtractorShape is stable for same output', () => {
    const output = {
      schema_version: '1.3',
      inbox_item_id: '00000000-0000-4000-8000-000000000001',
      entities: [{ name: 'Alex', entity_type: 'person' as const, source_excerpt: 'x', confidence: 0.9, aliases: [] }],
      events: [],
      assertions: [],
      tasks: [],
      clarification_requests: [],
      requires_review: false,
      review_reasons: [],
      processing_notes: [],
    };
    expect(hashExtractorShape(output)).toBe(hashExtractorShape(output));
  });
});
