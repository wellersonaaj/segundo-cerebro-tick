import { describe, expect, it, vi } from 'vitest';
import { ComposerService, resolveComposeContent } from '../src/services/composer.service.js';
import type { OpenAiRagClient } from '../src/services/rag/openai-rag.client.js';

describe('resolveComposeContent', () => {
  it('returns content with suffix when finish_reason=length and content non-empty', () => {
    expect(resolveComposeContent('Resposta parcial sobre Breno.', 'length')).toBe(
      'Resposta parcial sobre Breno. (continua...)',
    );
  });

  it('returns fallback when finish_reason=length and content empty', () => {
    expect(resolveComposeContent('', 'length')).toBe(
      'Pergunta complexa demais pra responder agora. Tenta reformular mais curto?',
    );
  });

  it('throws when content empty and finish_reason is not length', () => {
    expect(() => resolveComposeContent('', 'stop')).toThrow('compose: empty content');
  });
});

describe('ComposerService', () => {
  it('passes reasoning_effort low and max_completion_tokens 6000', async () => {
    const chatCompletion = vi.fn(async () => ({
      content: 'Voce tem consulta com Breno na quinta.',
      finish_reason: 'stop',
    }));
    const openai = { chatCompletion, embed: vi.fn() } as unknown as OpenAiRagClient;
    const service = new ComposerService(openai);

    const answer = await service.compose(
      'o que eu tenho com Breno?',
      [
        {
          id: '1',
          content: 'marquei consulta com Breno quinta 14h',
          source_channel: 'telegram',
          occurred_at: '2026-06-01',
          score: 0.9,
        },
      ],
    );

    expect(answer).toContain('Breno');
    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_effort: 'low',
        max_completion_tokens: 6000,
      }),
    );
  });
});
