import { describe, expect, it } from 'vitest';
import {
  assertSourceBlockExists,
  buildEffectiveInputWithSourceBlocks,
  listSourceBlockIds,
} from '../src/utils/source-blocks.js';
import { isAllowedSourceBlockReference } from '../src/openai/source-block-reference.js';

describe('source-blocks', () => {
  it('builds raw and correction blocks', () => {
    const input = buildEffectiveInputWithSourceBlocks({
      raw_content: 'Hello',
      corrections: [
        {
          id: '00000000-0000-4000-8000-000000000099',
          correction_text: 'Corrigido',
        },
      ],
    });
    expect(input).toContain('[SOURCE_BLOCK:raw]');
    expect(input).toContain('[SOURCE_BLOCK:correction:00000000-0000-4000-8000-000000000099]');
    const ids = listSourceBlockIds(input);
    expect(ids).toHaveLength(2);
  });

  it('validates SOURCE_BLOCK references', () => {
    const present = new Set([
      '[SOURCE_BLOCK:raw]',
      '[SOURCE_BLOCK:correction:00000000-0000-4000-8000-000000000001]',
    ]);
    expect(() =>
      assertSourceBlockExists('[SOURCE_BLOCK:raw]', present, 'test'),
    ).not.toThrow();
    expect(() =>
      assertSourceBlockExists('parágrafo 3', present, 'test'),
    ).toThrow();
    expect(isAllowedSourceBlockReference('parágrafo 3')).toBe(false);
  });
});
