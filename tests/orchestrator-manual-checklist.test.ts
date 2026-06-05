import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import type { AssistantTurnService } from '../src/services/assistant-turn.service.js';
import type { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { InboxItemRow, InboxItemsRepository } from '../src/repositories/inbox-items.repository.js';
import type { UnifiedRouterService } from '../src/services/unified-router.service.js';
import { TelegramInboxService } from '../src/services/telegram-inbox.service.js';
import type { ClarificationRequest } from '../src/types/domain.js';
import type { ParsedTelegramCapture } from '../src/telegram/parse-update.js';

const CHAT_ID = 5991664193;

const TELEGRAM_ENV = {
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_ALLOWED_USER_ID: String(CHAT_ID),
  TELEGRAM_WEBHOOK_SECRET: 'segredo_gerado',
  TELEGRAM_WEBHOOK_URL: 'https://example.com/webhook/telegram-cerebro-tick',
};

function capture(overrides: Partial<ParsedTelegramCapture> = {}): ParsedTelegramCapture {
  return {
    chatId: CHAT_ID,
    userId: CHAT_ID,
    messageId: 200,
    text: '1',
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function clarification(): ClarificationRequest {
  return {
    id: 'clarif-abc',
    inbox_item_id: 'inbox-d499',
    target_type: 'entity',
    target_reference: 'Breno',
    normalized_target_reference: 'breno',
    issue_type: 'ambiguous_entity',
    question: 'Qual tipo de info?',
    reason: 'test',
    priority: 1,
    blocking_scope: 'entity',
    materiality: 'high',
    suggested_answers: ['Compromissos / reuniões com datas', 'Tarefas'],
    source_excerpt: null,
    status: 'pending',
    record_status: 'active',
    answer: null,
    answered_at: null,
    extraction_run_id: null,
    created_at: '2026-06-05T19:26:00.000Z',
    updated_at: '2026-06-05T19:26:00.000Z',
  } as ClarificationRequest;
}

function inboxRow(): InboxItemRow {
  return {
    id: 'inbox-d499',
    raw_content: 'O que eu tenho com o breno?',
    source_channel: 'telegram',
    source_mode: 'conversational',
    received_at: '2026-06-05T19:25:00.000Z',
    timezone: 'America/Sao_Paulo',
    processing_status: 'completed',
    processed_at: '2026-06-05T19:26:00.000Z',
    processing_error: null,
    metadata: {
      telegram: { chat_id: CHAT_ID, user_id: CHAT_ID, message_id: 153 },
      telegram_clarification: {
        active_clarification_id: 'clarif-abc',
        prompt_message_id: 155,
      },
    },
  } as InboxItemRow;
}

describe('orchestrator manual checklist (automated)', () => {
  beforeEach(() => {
    Object.assign(process.env, TELEGRAM_ENV);
    resetEnvCache();
  });

  it('1 save — routes to capture via unified router', async () => {
    const router = {
      handle: vi.fn(async () => ({
        kind: 'async_started' as const,
        turn_id: 't-save',
        thread_id: 'telegram:chat:1',
      })),
    } as unknown as UnifiedRouterService;
    const service = new TelegramInboxService({} as InboxItemsRepository, router, {} as AssistantTurnService, null);
    const result = await service.handleIncoming(
      capture({ text: 'marquei consulta com Breno quinta 14h', messageId: 201 }),
    );
    expect(result.kind).toBe('async_started');
    expect(router.handle).toHaveBeenCalledOnce();
  });

  it('2 query — router returns sync RAG reply', async () => {
    const router = {
      handle: vi.fn(async () => ({
        kind: 'sync_reply' as const,
        text: 'Wellerson, você tem almoço com Breno no sábado.',
      })),
    } as unknown as UnifiedRouterService;
    const service = new TelegramInboxService({} as InboxItemsRepository, router, {} as AssistantTurnService, null);
    const result = await service.handleIncoming(
      capture({ text: 'o que eu tenho com o Breno?', messageId: 202 }),
    );
    expect(result.kind).toBe('async_started');
    expect(router.handle).toHaveBeenCalledWith(expect.objectContaining({ text: 'o que eu tenho com o Breno?' }));
  });

  it('3 update — router receives correction text', async () => {
    const router = {
      handle: vi.fn(async () => ({
        kind: 'async_started' as const,
        turn_id: 't-update',
        thread_id: 'telegram:chat:1',
      })),
    } as unknown as UnifiedRouterService;
    const service = new TelegramInboxService({} as InboxItemsRepository, router, {} as AssistantTurnService, null);
    await service.handleIncoming(
      capture({ text: 'na verdade era sexta, não quinta', messageId: 203 }),
    );
    expect(router.handle).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'na verdade era sexta, não quinta' }),
    );
  });

  it('4 command — router handles slash command', async () => {
    const router = {
      handle: vi.fn(async () => ({ kind: 'sync_reply' as const, text: 'Bot OK' })),
    } as unknown as UnifiedRouterService;
    const service = new TelegramInboxService({} as InboxItemsRepository, router, {} as AssistantTurnService, null);
    await service.handleIncoming(capture({ text: '/status', messageId: 204 }));
    expect(router.handle).toHaveBeenCalledWith(expect.objectContaining({ text: '/status' }));
  });

  it('5 clarification answer "1" — resolves pending, does NOT call router', async () => {
    const inboxRepo = {
      listTelegramByChatId: vi.fn(async () => [inboxRow()]),
      findById: vi.fn(async () => inboxRow()),
      updateMetadata: vi.fn(async () => undefined),
      create: vi.fn(),
    } as unknown as InboxItemsRepository;

    const clarificationsRepo = {
      listPendingForTelegramChat: vi.fn(async () => [clarification()]),
      listAnsweredByInboxItem: vi.fn(async () => []),
      findById: vi.fn(async () => clarification()),
    } as unknown as ClarificationsRepository;

    const assistantTurn = {
      resolveClarification: vi.fn(async () => ({
        turn_id: 'resolved-turn',
        thread_id: `telegram:chat:${CHAT_ID}`,
      })),
      startCapture: vi.fn(),
    } as unknown as AssistantTurnService;

    const router = {
      handle: vi.fn(),
    } as unknown as UnifiedRouterService;

    const service = new TelegramInboxService(inboxRepo, router, assistantTurn, clarificationsRepo);
    const result = await service.handleIncoming(capture({ text: '1', messageId: 205 }));

    expect(result.kind).toBe('clarification_resolved');
    expect(result).toMatchObject({
      answer: 'Compromissos / reuniões com datas',
      inbox_item_id: 'inbox-d499',
    });
    expect(assistantTurn.resolveClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        clarification_id: 'clarif-abc',
        inbox_item_id: 'inbox-d499',
        answer: 'Compromissos / reuniões com datas',
      }),
    );
    expect(router.handle).not.toHaveBeenCalled();
  });
});
