import { describe, expect, it, vi } from 'vitest';
import { createNoOpDelivery } from '../src/services/assistant-delivery.js';
import { AssistantTurnService } from '../src/services/assistant-turn.service.js';
import type { CorrectionService } from '../src/services/correction.service.js';
import type { ThreadConversationContextService } from '../src/services/thread-conversation-context.service.js';
import type { RetrievalService } from '../src/services/retrieval.service.js';
import { formatRetrievalAsContextBlock } from '../src/services/pre-context.service.js';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    text: 'na verdade era sexta',
    thread_id: 'telegram:chat:99',
    channel: 'telegram' as const,
    received_at: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    delivery: createNoOpDelivery(),
    mode: 'correction' as const,
    ...overrides,
  };
}

describe('AssistantTurnService correction mode', () => {
  it('applies correction on latest inbox in thread', async () => {
    const inboxRow = {
      id: 'inbox-target',
      raw_content: 'consulta quinta',
      metadata: { assistant: { thread_id: 'telegram:chat:99' } },
      source_channel: 'telegram',
    };

    const threadContext = {
      findLatestInboxInThread: vi.fn(async () => inboxRow),
    } as unknown as ThreadConversationContextService;

    const correctionService = {
      applyCorrection: vi.fn(async () => ({
        correction_id: 'corr-1',
        processing_status: 'completed' as const,
        extraction_run_id: 'run-1',
      })),
    } as unknown as CorrectionService;

    const inboxRepo = {
      findById: vi.fn(async (id: string) =>
        id === 'inbox-target'
          ? { id, raw_content: 'consulta quinta', metadata: {}, processing_status: 'completed' }
          : null,
      ),
      listRecent: vi.fn(async () => []),
      updateMetadata: vi.fn(async () => {}),
    };

    const clarificationsRepo = {
      listPendingByInboxItem: vi.fn(async () => []),
      listAnsweredByInboxItem: vi.fn(async () => []),
    };

    const service = new AssistantTurnService(
      inboxRepo as never,
      null,
      clarificationsRepo as never,
      null,
      { listByInboxItem: vi.fn(async () => []) } as never,
      { findById: vi.fn(async () => null) } as never,
      correctionService,
      threadContext,
    );

    const ack = await service.startCapture(baseInput());
    expect(ack.turn_id).toBeTruthy();
    expect(threadContext.findLatestInboxInThread).toHaveBeenCalledWith('telegram:chat:99');

    await vi.waitFor(() =>
      expect(correctionService.applyCorrection).toHaveBeenCalledWith(
        'inbox-target',
        'na verdade era sexta',
      ),
    );
  });

  it('returns explicit error when thread has no capture', async () => {
    const followUps: string[] = [];
    const delivery = {
      sendAck: vi.fn(async () => {}),
      sendFollowUp: vi.fn(async (msg: string) => {
        followUps.push(msg);
        return null;
      }),
    };

    const threadContext = {
      findLatestInboxInThread: vi.fn(async () => null),
    } as unknown as ThreadConversationContextService;

    const inboxRepo = {
      listRecent: vi.fn(async () => []),
    };

    const service = new AssistantTurnService(
      inboxRepo as never,
      null,
      { listPendingByInboxItem: vi.fn(), listAnsweredByInboxItem: vi.fn() } as never,
      null,
      { listByInboxItem: vi.fn(async () => []) } as never,
      { findById: vi.fn(async () => null) } as never,
      { applyCorrection: vi.fn() } as never,
      threadContext,
    );

    await service.startCapture(baseInput({ delivery }));
    await vi.waitFor(() => expect(followUps.length).toBeGreaterThan(0));
    expect(followUps[0]).toContain('Corrigir o quê?');
  });

  it('capture mode creates inbox without correction service', async () => {
    const inboxRepo = {
      findBySourceReference: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'new-inbox' })),
      findById: vi.fn(async () => ({
        id: 'new-inbox',
        raw_content: 'marquei consulta',
        metadata: {},
        processing_status: 'completed',
      })),
      updateMetadata: vi.fn(async () => {}),
    };

    const v14Process = {
      processById: vi.fn(async () => ({
        inbox_item_id: 'new-inbox',
        processing_status: 'completed' as const,
        extraction_run_id: 'run-1',
      })),
    };

    const clarificationsRepo = {
      listPendingByInboxItem: vi.fn(async () => []),
      listAnsweredByInboxItem: vi.fn(async () => []),
    };

    const service = new AssistantTurnService(
      inboxRepo as never,
      v14Process as never,
      clarificationsRepo as never,
      null,
      { listByInboxItem: vi.fn(async () => []) } as never,
      { findById: vi.fn(async () => null) } as never,
    );

    await service.startCapture({
      text: 'marquei consulta quinta 14h',
      thread_id: 'telegram:chat:1',
      channel: 'telegram',
      received_at: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      delivery: createNoOpDelivery(),
      mode: 'capture',
    });

    await vi.waitFor(() => expect(inboxRepo.create).toHaveBeenCalled());
  });
});

describe('AssistantTurnService pre-context', () => {
  it('passes preContextBlock to processById when retrieval returns hits', async () => {
    const retrievalResult = {
      inbox: [
        {
          id: '1',
          content: 'marquei consulta com Breno quinta 14h',
          source_channel: 'telegram',
          occurred_at: '2026-06-01',
          score: 0.9,
        },
      ],
      assertions: [],
      latencyMs: 10,
    };

    const retrieval = {
      retrieve: vi.fn(async () => retrievalResult),
    } as unknown as RetrievalService;

    const processById = vi.fn(async () => ({
      ok: true,
      inbox_item_id: 'new-inbox',
      processing_status: 'completed' as const,
      extraction_run_id: 'run-1',
    }));

    const inboxRepo = {
      findBySourceReference: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'new-inbox' })),
      findById: vi.fn(async () => null),
      updateMetadata: vi.fn(async () => {}),
    };

    const service = new AssistantTurnService(
      inboxRepo as never,
      { processById } as never,
      { listPendingByInboxItem: vi.fn(), listAnsweredByInboxItem: vi.fn() } as never,
      null,
      { listByInboxItem: vi.fn(async () => []) } as never,
      { findById: vi.fn(async () => null) } as never,
      null,
      null,
      retrieval,
    );

    await service.startCapture({
      text: 'reunião com Breno amanhã',
      thread_id: 'telegram:chat:1',
      channel: 'telegram',
      received_at: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      delivery: createNoOpDelivery(),
      mode: 'capture',
    });

    await vi.waitFor(() => expect(processById).toHaveBeenCalled());
    const expectedBlock = formatRetrievalAsContextBlock(retrievalResult);
    expect(processById).toHaveBeenCalledWith('new-inbox', { preContextBlock: expectedBlock });
  });
});
