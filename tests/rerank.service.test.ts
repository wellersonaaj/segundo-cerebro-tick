import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RerankService } from '../src/services/rerank.service.js';
import type { RankedRow } from '../src/services/rag/rag.types.js';
import type { OpenAiRagClient } from '../src/services/rag/openai-rag.client.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/rag-pipeline.fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Array<{
  name: string;
  query: string;
  items: RankedRow[];
  rerank_scores: string[];
  keep: number;
  expected_top_id: string;
}>;

describe('RerankService', () => {
  it('returns items unchanged when count <= keep', async () => {
    const openai: OpenAiRagClient = {
      embed: vi.fn(),
      chatCompletion: vi.fn(),
    };
    const service = new RerankService(openai);
    const items: RankedRow[] = [
      { id: 'a', content: 'x', source_channel: 'telegram', occurred_at: '', score: 1 },
    ];
    const result = await service.rerank('q', items, 3);
    expect(result).toEqual(items);
    expect(openai.chatCompletion).not.toHaveBeenCalled();
  });

  it('reranks and keeps top items by parsed LLM scores', async () => {
    const caseDef = fixture.find((c) => c.name === 'rerank_keeps_top_scores')!;
    const openai: OpenAiRagClient = {
      embed: vi.fn(),
      chatCompletion: vi.fn(async () => ({
        content: caseDef.rerank_scores.join('\n'),
      })),
    };
    const service = new RerankService(openai);
    const result = await service.rerank(caseDef.query, caseDef.items, caseDef.keep);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(caseDef.expected_top_id);
    expect(result[0]?.score).toBe(9);
  });
});
