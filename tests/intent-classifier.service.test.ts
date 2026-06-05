import { describe, expect, it, vi } from 'vitest';
import {
  IntentClassifierService,
  parseIntentLlmResponse,
  type IntentClassifierLlmClient,
} from '../src/services/intent-classifier.service.js';

function mockClient(response: string, finish_reason = 'stop'): IntentClassifierLlmClient {
  return {
    completeJson: vi.fn(async () => ({ content: response, finish_reason })),
  };
}

describe('parseIntentLlmResponse', () => {
  it('parses valid JSON', () => {
    const result = parseIntentLlmResponse(
      JSON.stringify({
        intent: 'query',
        confidence: 0.91,
        reasoning: 'pergunta',
      }),
    );
    expect(result?.intent).toBe('query');
    expect(result?.confidence).toBe(0.91);
  });

  it('falls back to save when confidence < 0.5', () => {
    const result = parseIntentLlmResponse(
      JSON.stringify({
        intent: 'query',
        confidence: 0.3,
        reasoning: 'incerto',
      }),
    );
    expect(result?.intent).toBe('save');
    expect(result?.confidence).toBe(0.4);
  });

  it('returns null for malformed JSON', () => {
    expect(parseIntentLlmResponse('not json')).toBeNull();
  });
});

describe('IntentClassifierService', () => {
  it('classifies save intent', async () => {
    const service = new IntentClassifierService(
      mockClient(
        JSON.stringify({
          intent: 'save',
          confidence: 0.95,
          reasoning: 'captura',
        }),
      ),
    );
    const result = await service.classify('marquei consulta com Breno quinta 14h');
    expect(result.intent).toBe('save');
  });

  it('classifies update intent', async () => {
    const service = new IntentClassifierService(
      mockClient(
        JSON.stringify({
          intent: 'update',
          confidence: 0.93,
          reasoning: 'correcao',
        }),
      ),
    );
    const result = await service.classify('na verdade era sexta, não quinta');
    expect(result.intent).toBe('update');
  });

  it('classifies query intent', async () => {
    const service = new IntentClassifierService(
      mockClient(
        JSON.stringify({
          intent: 'query',
          confidence: 0.96,
          reasoning: 'pergunta memoria',
        }),
      ),
    );
    const result = await service.classify('o que eu tenho com Breno essa semana?');
    expect(result.intent).toBe('query');
  });

  it('short-circuits command without LLM call', async () => {
    const llm = mockClient('{}');
    const service = new IntentClassifierService(llm);
    const result = await service.classify('/status');
    expect(result.intent).toBe('command');
    expect(result.suggested_command).toBe('/status');
    expect(llm.completeJson).not.toHaveBeenCalled();
  });

  it('falls back to save on malformed LLM response', async () => {
    const service = new IntentClassifierService(mockClient('{invalid'));
    const result = await service.classify('mensagem estranha');
    expect(result.intent).toBe('save');
    expect(result.reasoning).toContain('malformada');
  });

  it('falls back to save on LLM error', async () => {
    const service = new IntentClassifierService({
      completeJson: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    const result = await service.classify('algo');
    expect(result.intent).toBe('save');
    expect(result.reasoning).toContain('llm error');
  });

  it('uses reasoning_effort low and 500 max tokens by default', async () => {
    const llm: IntentClassifierLlmClient = {
      completeJson: vi.fn(async () => ({
        content: JSON.stringify({
          intent: 'query',
          confidence: 0.9,
          reasoning: 'pergunta',
        }),
        finish_reason: 'stop',
      })),
    };
    const service = new IntentClassifierService(llm);
    await service.classify('o que eu tenho com Breno?');
    expect(llm.completeJson).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 500 }),
    );
  });
});
