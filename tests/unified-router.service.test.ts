import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createNoOpDelivery } from '../src/services/assistant-delivery.js';
import type { AssistantTurnService } from '../src/services/assistant-turn.service.js';
import type { CommandHandlerService } from '../src/services/command-handler.service.js';
import type { IntentClassifierService, IntentResult } from '../src/services/intent-classifier.service.js';
import type { RAGPipelineService } from '../src/services/rag-pipeline.service.js';
import { UnifiedRouterService } from '../src/services/unified-router.service.js';

const baseInput = {
  capture: {
    chatId: 123,
    userId: 456,
    messageId: 1,
    text: 'hello',
    receivedAt: new Date().toISOString(),
  },
  text: 'hello',
  threadId: 'telegram:chat:123',
  delivery: createNoOpDelivery(),
  receivedAt: new Date().toISOString(),
  timezone: 'America/Sao_Paulo',
  sourceReference: 'telegram:123:1',
  metadata: {},
};

function intent(result: IntentResult): IntentClassifierService {
  return {
    classify: vi.fn(async () => result),
  } as unknown as IntentClassifierService;
}

function assistantTurn(): AssistantTurnService {
  return {
    startCapture: vi.fn(async () => ({
      turn_id: 'turn-capture',
      thread_id: baseInput.threadId,
      ack_message: 'ok',
    })),
  } as unknown as AssistantTurnService;
}

function rag(answer = 'resposta rag'): RAGPipelineService {
  return {
    answer: vi.fn(async () => ({ answer, sources: [], confidence: 0.9 })),
  } as unknown as RAGPipelineService;
}

function commands(text = 'cmd ok'): CommandHandlerService {
  return {
    handle: vi.fn(async () => ({ text })),
  } as unknown as CommandHandlerService;
}

describe('UnifiedRouterService', () => {
  it('routes save to assistantTurn with mode capture', async () => {
    const turn = assistantTurn();
    const router = new UnifiedRouterService(
      intent({ intent: 'save', confidence: 0.9, reasoning: 'captura' }),
      turn,
      rag(),
      commands(),
      true,
    );
    const result = await router.handle(baseInput);
    expect(result.kind).toBe('async_started');
    expect(turn.startCapture).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'capture', text: 'hello' }),
    );
  });

  it('routes update to assistantTurn with mode correction', async () => {
    const turn = assistantTurn();
    const router = new UnifiedRouterService(
      intent({ intent: 'update', confidence: 0.9, reasoning: 'corrige' }),
      turn,
      rag(),
      commands(),
      true,
    );
    await router.handle({ ...baseInput, text: 'na verdade era sexta' });
    expect(turn.startCapture).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'correction' }),
    );
  });

  it('routes query to rag.answer', async () => {
    const ragSvc = rag('Breno na quinta');
    const router = new UnifiedRouterService(
      intent({ intent: 'query', confidence: 0.95, reasoning: 'pergunta' }),
      assistantTurn(),
      ragSvc,
      commands(),
      true,
    );
    const result = await router.handle({ ...baseInput, text: 'o que tenho com Breno?' });
    expect(result).toEqual({ kind: 'sync_reply', text: 'Breno na quinta' });
    expect(ragSvc.answer).toHaveBeenCalledWith('o que tenho com Breno?');
  });

  it('routes command to command handler', async () => {
    const cmdSvc = commands('*Status*');
    const router = new UnifiedRouterService(
      intent({
        intent: 'command',
        confidence: 0.99,
        reasoning: 'slash',
        suggested_command: '/status',
      }),
      assistantTurn(),
      rag(),
      cmdSvc,
      true,
    );
    const result = await router.handle({ ...baseInput, text: '/status' });
    expect(result).toEqual({ kind: 'sync_reply', text: '*Status*' });
    expect(cmdSvc.handle).toHaveBeenCalledWith('/status', [], expect.any(Object));
  });

  it('skips classifier when disabled and always saves', async () => {
    const classifier = intent({ intent: 'query', confidence: 0.99, reasoning: 'would query' });
    const turn = assistantTurn();
    const router = new UnifiedRouterService(classifier, turn, rag(), commands(), false);
    await router.handle({ ...baseInput, text: 'o que tenho com Breno?' });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(turn.startCapture).toHaveBeenCalledWith(expect.objectContaining({ mode: 'capture' }));
  });

  it('logs stages when ALS is active', async () => {
    const stages: string[] = [];
    const turnId = randomUUID();
    const { runWithTurn, getCurrentTurn } = await import('../src/utils/turn-context.js');

    const router = new UnifiedRouterService(
      intent({ intent: 'query', confidence: 0.9, reasoning: 'q' }),
      assistantTurn(),
      rag('ok'),
      commands(),
      true,
    );

    await runWithTurn({ turn_id: turnId, chat_id: 1 }, async () => {
      const turn = getCurrentTurn()!;
      const orig = turn.handle.stage.bind(turn.handle);
      turn.handle.stage = async (stage, fnOrOpts) => {
        stages.push(String(stage));
        return orig(stage, fnOrOpts);
      };
      await router.handle({ ...baseInput, text: 'pergunta?' });
    });

    expect(stages).toContain('intent_classify');
    expect(stages).toContain('route_dispatch');
    expect(stages).toContain('compose');
  });
});
