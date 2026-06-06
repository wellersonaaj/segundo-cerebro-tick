import { describe, expect, it, vi } from 'vitest';
import { buildExtractorV14UserMessage } from '../src/openai/extractor-v1.4.prompt.js';
import type { ExtractV14Fn } from '../src/openai/extractor-v1.4.service.js';
import { ExtractorV14CompileService } from '../src/services/extractor-v14-compile.service.js';
import { formatRetrievalAsContextBlock } from '../src/services/pre-context.service.js';
import type { RetrieveResult } from '../src/services/retrieval.service.js';
import type { InboxItem } from '../src/types/domain.js';
import { createMockExtractV14, loadExtractorV14Fixture } from './helpers/mock-extractor-v14.js';
import { createEmptySupabaseMock } from './helpers/mock-supabase.js';

const sampleRetrieval: RetrieveResult = {
  inbox: [
    {
      id: 'inbox-1',
      content: 'marquei consulta com Breno quinta 14h',
      source_channel: 'telegram',
      occurred_at: '2026-06-01T14:00',
      score: 0.92,
    },
    {
      id: 'inbox-2',
      content: 'almocei com a Lari, falei do ESX',
      source_channel: 'telegram',
      occurred_at: '2026-06-02T12:00',
      score: 0.88,
    },
  ],
  assertions: [
    {
      id: 'assert-1',
      content: 'Projeto ESX status em risco',
      source_channel: 'memory',
      occurred_at: '2026-06-03T09:00',
      score: 0.85,
    },
  ],
  latencyMs: 42,
};

describe('formatRetrievalAsContextBlock', () => {
  it('formats inbox and assertion hits', () => {
    const block = formatRetrievalAsContextBlock(sampleRetrieval);
    expect(block).toContain('[CONTEXTO_RECUPERADO_DA_MEMORIA]');
    expect(block).toContain('marquei consulta com Breno quinta 14h');
    expect(block).toContain('almocei com a Lari');
    expect(block).toContain('Projeto ESX status em risco');
  });

  it('returns empty string when no hits', () => {
    expect(formatRetrievalAsContextBlock({ inbox: [], assertions: [], latencyMs: 1 })).toBe('');
  });
});

describe('buildExtractorV14UserMessage with pre-context', () => {
  it('injects retrieval_context before effective_input', () => {
    const contextBlock = formatRetrievalAsContextBlock(sampleRetrieval);
    const message = buildExtractorV14UserMessage({
      effective_input: 'reunião com Breno amanhã',
      received_at: '2026-06-05T10:00:00-03:00',
      timezone: 'America/Sao_Paulo',
      source_channel: 'telegram',
      source_mode: 'conversational',
      context_block: contextBlock,
    });
    expect(message).toContain('<retrieval_context>');
    expect(message).toContain('marquei consulta com Breno quinta 14h');
    expect(message.indexOf('<retrieval_context>')).toBeLessThan(
      message.indexOf('<effective_input>'),
    );
  });

  it('omits retrieval_context when absent', () => {
    const message = buildExtractorV14UserMessage({
      effective_input: 'nota simples',
      received_at: '2026-06-05T10:00:00-03:00',
      timezone: 'America/Sao_Paulo',
      source_channel: 'telegram',
      source_mode: 'conversational',
    });
    expect(message).not.toContain('<retrieval_context>');
  });
});

describe('ExtractorV14CompileService pre-context', () => {
  const inboxItem: InboxItem = {
    id: 'f0000000-0000-4000-8000-000000000099',
    // raw_content must include all entity_mentions in the fixture so the
    // anti-hallucination sanitizer doesn't drop them.
    raw_content:
      'Alex Costa (Ace) participou da reunião de integração do Projeto Atlas. ' +
      'Dana Silva deve enviar o relatório Q2. ' +
      '[CORREÇÃO] Na verdade, Bruno Vega participou.',
    source_channel: 'telegram',
    source_mode: 'conversational',
    received_at: '2026-06-05T10:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    processing_status: 'pending',
    extractor_version: null,
    processing_error: null,
    processed_at: null,
    active_extraction_run_id: null,
    latest_extraction_run_id: null,
    created_at: '2026-06-05T10:00:00Z',
  };

  it('forwards context_block to extractV14', async () => {
    const contextBlock = formatRetrievalAsContextBlock(sampleRetrieval);
    const extractV14 = vi.fn(createMockExtractV14()) as ExtractV14Fn;
    const compileService = new ExtractorV14CompileService(
      createEmptySupabaseMock() as never,
      extractV14,
    );

    await compileService.compileFromInbox(inboxItem, { preContextBlock: contextBlock });

    expect(extractV14).toHaveBeenCalledWith(
      expect.objectContaining({
        context_block: contextBlock,
        effective_input: expect.stringContaining('Alex Costa'),
      }),
    );
  });

  it('works without preContextBlock', async () => {
    const extractV14 = vi.fn(createMockExtractV14()) as ExtractV14Fn;
    const compileService = new ExtractorV14CompileService(
      createEmptySupabaseMock() as never,
      extractV14,
    );
    const result = await compileService.compileFromInbox(inboxItem);
    expect(result.output).toEqual(loadExtractorV14Fixture());
    expect(extractV14).toHaveBeenCalledWith(
      expect.objectContaining({ context_block: undefined }),
    );
  });
});
