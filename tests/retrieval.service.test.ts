import { describe, expect, it, vi } from 'vitest';
import { EmbedderService } from '../src/services/embedder.service.js';
import { RetrievalService } from '../src/services/retrieval.service.js';
import type { OpenAiRagClient } from '../src/services/rag/openai-rag.client.js';

describe('RetrievalService', () => {
  it('embeds query and calls hybrid_search RPCs for inbox and assertions', async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const inboxRow = {
      id: 'inbox-1',
      raw_content: 'Almoco com Breno',
      source_channel: 'telegram',
      occurred_at: '2026-06-01T12:00:00Z',
      combined_score: 0.8,
      vector_rank: 1,
      text_rank: 2,
    };

    const db = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === 'hybrid_search_inbox_items') return { data: [inboxRow], error: null };
        if (fn === 'hybrid_search_assertions') return { data: [], error: null };
        return { data: [], error: null };
      }),
    };

    const openai: OpenAiRagClient = {
      embed: vi.fn(async () => [0.1, 0.2]),
      chatCompletion: vi.fn(async () => ({ content: '' })),
    };
    const embedder = new EmbedderService(openai);
    const service = new RetrievalService(db as never, embedder);

    const result = await service.retrieve('Breno', { topKInbox: 3, topKAssertions: 2 });

    expect(openai.embed).toHaveBeenCalledWith('Breno', 'text-embedding-3-small');
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'hybrid_search_inbox_items',
      'hybrid_search_assertions',
    ]);
    expect(rpcCalls[0]?.args.p_limit).toBe(3);
    expect(result.inbox).toHaveLength(1);
    expect(result.inbox[0]?.content).toBe('Almoco com Breno');
    expect(result.assertions).toHaveLength(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
