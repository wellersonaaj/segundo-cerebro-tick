import { describe, expect, it } from 'vitest';
import { parseCorrectionBlocks } from '../src/utils/correction-blocks.js';

describe('parseCorrectionBlocks', () => {
  it('splits raw content and corrections', () => {
    const content = 'Chris participou.\n\n[CORREÇÃO] Bruno participou.';
    const parsed = parseCorrectionBlocks(content);
    expect(parsed.rawContent).toBe('Chris participou.');
    expect(parsed.corrections).toEqual(['Bruno participou.']);
    expect(parsed.effectiveContent).toContain('[CORREÇÃO]');
  });
});
