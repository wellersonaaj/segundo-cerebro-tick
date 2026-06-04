import { describe, expect, it } from 'vitest';
import {
  isEntityPrecisionApplicable,
  matchesMustNotEntityMention,
} from '../src/calibration/extractor-v1.4/entity-mention-match.js';

describe('entity-mention-match', () => {
  it('matches exact normalized tokens only', () => {
    expect(matchesMustNotEntityMention('Zeta', 'Zeta')).toBe(true);
    expect(matchesMustNotEntityMention('Zeta-1', 'Zeta')).toBe(false);
    expect(matchesMustNotEntityMention('Fox', 'Fox')).toBe(true);
    expect(matchesMustNotEntityMention('Fox-3', 'Fox')).toBe(false);
    expect(matchesMustNotEntityMention('Tick-5', 'Tick')).toBe(false);
    expect(matchesMustNotEntityMention('Helcio Zeta', 'Zeta')).toBe(false);
    expect(matchesMustNotEntityMention('Sam Fox', 'Fox')).toBe(false);
    expect(matchesMustNotEntityMention('Gabriel Nova', 'Zeta')).toBe(false);
  });

  it('skips entity precision for alias-first and primary-contract categories', () => {
    expect(
      isEntityPrecisionApplicable('alias_negation', ['Zeta'], ['Gabriel Nova'], []),
    ).toBe(false);
    expect(isEntityPrecisionApplicable('static_preferences', [], [], [])).toBe(false);
    expect(isEntityPrecisionApplicable('task_open', [], [], [])).toBe(false);
    expect(isEntityPrecisionApplicable('explicit_alias', ['Tick'], ['Alex Costa'], [])).toBe(
      true,
    );
  });
});
