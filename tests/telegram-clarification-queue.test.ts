import { describe, expect, it, vi } from 'vitest';
import type { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { InboxItemRow, InboxItemsRepository } from '../src/repositories/inbox-items.repository.js';
import { TelegramClarificationQueueService } from '../src/services/telegram-clarification-queue.service.js';
import type { ClarificationRequest } from '../src/types/domain.js';

const CHAT_ID = 5991664193;

function clarification(overrides: Partial<ClarificationRequest> = {}): ClarificationRequest {
  return {
    id: 'clarif-1',
    inbox_item_id: 'inbox-1',
    target_type: 'entity',
    target_reference: 'Breno',
    normalized_target_reference: 'breno',
    issue_type: 'ambiguous_entity',
    question: 'Qual entidade?',
    reason: 'test',
    priority: 1,
    blocking_scope: 'entity',
    materiality: 'high',
    suggested_answers: ['Compromissos', 'Tarefas'],
    source_excerpt: null,
    status: 'pending',
    record_status: 'active',
    answer: null,
    answered_at: null,
    extraction_run_id: null,
    created_at: '2026-06-05T19:26:00.000Z',
    updated_at: '2026-06-05T19:26:00.000Z',
    ...overrides,
  } as ClarificationRequest;
}

function inbox(id: string, promptMessageId?: number): InboxItemRow {
  return {
    id,
    raw_content: 'test',
    source_channel: 'telegram',
    source_mode: 'conversational',
    received_at: '2026-06-05T19:25:00.000Z',
    timezone: 'America/Sao_Paulo',
    processing_status: 'completed',
    processed_at: '2026-06-05T19:26:00.000Z',
    processing_error: null,
    metadata: {
      telegram: { chat_id: CHAT_ID, user_id: CHAT_ID, message_id: 153 },
      ...(promptMessageId != null
        ? {
            telegram_clarification: {
              active_clarification_id: 'clarif-1',
              prompt_message_id: promptMessageId,
            },
          }
        : {}),
    },
  } as InboxItemRow;
}

function mockRepos(options: {
  inboxes: InboxItemRow[];
  pending: ClarificationRequest[];
  findById?: (id: string) => ClarificationRequest | null;
}) {
  const inboxRepo = {
    listTelegramByChatId: vi.fn(async () => options.inboxes),
    findById: vi.fn(async (id: string) => options.inboxes.find((i) => i.id === id) ?? null),
  } as unknown as InboxItemsRepository;

  const clarificationsRepo = {
    listPendingForTelegramChat: vi.fn(async () => options.pending),
    listAnsweredByInboxItem: vi.fn(async () => []),
    findById: vi.fn(async (id: string) => {
      if (options.findById) return options.findById(id);
      return options.pending.find((c) => c.id === id) ?? null;
    }),
  } as unknown as ClarificationsRepository;

  return { inboxRepo, clarificationsRepo };
}

describe('TelegramClarificationQueueService', () => {
  it('findByPromptMessageId resolves reply target', async () => {
    const { inboxRepo, clarificationsRepo } = mockRepos({
      inboxes: [inbox('inbox-1', 155)],
      pending: [clarification()],
    });
    const queue = new TelegramClarificationQueueService(inboxRepo, clarificationsRepo);
    const ctx = await queue.findByPromptMessageId(CHAT_ID, 155);
    expect(ctx?.clarification.id).toBe('clarif-1');
    expect(ctx?.inbox.id).toBe('inbox-1');
  });

  it('findNewestPendingForChat returns newest pending when metadata is missing', async () => {
    const older = clarification({ id: 'old', inbox_item_id: 'inbox-old', created_at: '2026-06-05T19:20:00.000Z' });
    const newer = clarification({ id: 'new', inbox_item_id: 'inbox-new', created_at: '2026-06-05T19:26:00.000Z' });
    const { inboxRepo, clarificationsRepo } = mockRepos({
      inboxes: [inbox('inbox-new'), inbox('inbox-old')],
      pending: [older, newer],
      findById: (id) => [older, newer].find((c) => c.id === id) ?? null,
    });
    const queue = new TelegramClarificationQueueService(inboxRepo, clarificationsRepo);
    const ctx = await queue.findNewestPendingForChat(CHAT_ID);
    expect(ctx?.clarification.id).toBe('new');
  });

  it('findPendingClarificationForChat falls back to newest pending without metadata', async () => {
    const pendingClarif = clarification({ id: 'pending-1', inbox_item_id: 'inbox-1' });
    const { inboxRepo, clarificationsRepo } = mockRepos({
      inboxes: [inbox('inbox-1')],
      pending: [pendingClarif],
    });
    const queue = new TelegramClarificationQueueService(inboxRepo, clarificationsRepo);
    const trace: Array<{ step: string; result: string }> = [];
    const ctx = await queue.findPendingClarificationForChat(CHAT_ID, { trace });
    expect(ctx?.clarification.id).toBe('pending-1');
    expect(trace.some((t) => t.step === 'findActiveClarificationForChat' && t.result === 'miss')).toBe(true);
    expect(trace.some((t) => t.step === 'findNewestPendingForChat' && t.result === 'hit')).toBe(true);
  });

  it('findPendingClarificationForChat skips archived inbox', async () => {
    const archived = inbox('inbox-archived', 155);
    archived.metadata = {
      ...archived.metadata,
      archived: true,
    };
    const pendingClarif = clarification({ id: 'pending-archived', inbox_item_id: 'inbox-archived' });
    const { inboxRepo, clarificationsRepo } = mockRepos({
      inboxes: [archived],
      pending: [pendingClarif],
      findById: () => pendingClarif,
    });
    const queue = new TelegramClarificationQueueService(inboxRepo, clarificationsRepo);
    const ctx = await queue.findNewestPendingForChat(CHAT_ID);
    expect(ctx).toBeNull();
  });

  it('accepts string chat_id in metadata', async () => {
    const row = inbox('inbox-1', 155);
    row.metadata = {
      telegram: { chat_id: String(CHAT_ID), user_id: CHAT_ID, message_id: 153 },
      telegram_clarification: {
        active_clarification_id: 'clarif-1',
        prompt_message_id: 155,
      },
    };
    const { inboxRepo, clarificationsRepo } = mockRepos({
      inboxes: [row],
      pending: [clarification()],
    });
    const queue = new TelegramClarificationQueueService(inboxRepo, clarificationsRepo);
    const ctx = await queue.findActiveClarificationForChat(CHAT_ID);
    expect(ctx?.clarification.id).toBe('clarif-1');
  });
});
