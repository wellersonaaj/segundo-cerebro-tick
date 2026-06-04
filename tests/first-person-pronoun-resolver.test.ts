import { describe, expect, it } from 'vitest';
import { applyFirstPersonPronounToResolverResult, isFirstPersonPronoun } from '../src/services/first-person-pronoun-resolver.js';
import type { MemoryResolverResult, ResolvedReference } from '../src/services/reference-resolver.service.js';

describe('first-person-pronoun-resolver', () => {
  const sender: ResolvedReference = {
    reference_text: 'Wellerson Assumpção',
    status: 'resolved',
    entity_id: 'wellerson-id',
    canonical_name: 'Wellerson Assumpção',
    candidates: [],
    confidence: 0.95,
  };

  const base: MemoryResolverResult = {
    references: [
      {
        reference_text: 'eu',
        status: 'unresolved',
        entity_id: null,
        canonical_name: null,
        candidates: [],
        confidence: 0,
      },
    ],
    byReferenceText: new Map([
      [
        'eu',
        {
          reference_text: 'eu',
          status: 'unresolved',
          entity_id: null,
          canonical_name: null,
          candidates: [],
          confidence: 0,
        },
      ],
    ]),
  };

  it('detects first person pronouns', () => {
    expect(isFirstPersonPronoun('eu')).toBe(true);
    expect(isFirstPersonPronoun('Brant')).toBe(false);
  });

  it('maps eu to sender in conversational mode', () => {
    const result = applyFirstPersonPronounToResolverResult(base, 'conversational', sender);
    const eu = result.byReferenceText.get('eu');
    expect(eu?.status).toBe('resolved');
    expect(eu?.entity_id).toBe('wellerson-id');
  });

  it('does not map in passive mode', () => {
    const result = applyFirstPersonPronounToResolverResult(base, 'passive', sender);
    expect(result.byReferenceText.get('eu')?.status).toBe('unresolved');
  });
});
