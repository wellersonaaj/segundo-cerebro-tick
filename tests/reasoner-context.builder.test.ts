import { describe, expect, it, vi } from 'vitest';
import { buildReasonerContext } from '../src/services/reasoner-context.builder.js';
import type { InboxItem } from '../src/types/domain.js';
import type { InboxItemsRepository } from '../src/repositories/inbox-items.repository.js';
import type { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { TasksRepository } from '../src/repositories/tasks.repository.js';
import type { ThreadConversationContextService } from '../src/services/thread-conversation-context.service.js';

const fakeInbox: InboxItem = {
  id: 'inbox_1',
  raw_content: 'msg',
  source_channel: 'telegram',
  source_mode: 'conversational',
  received_at: '2026-06-07T10:00:00Z',
  timezone: 'America/Sao_Paulo',
  metadata: {},
  processing_status: 'pending',
};

const fakeInboxRepo: Pick<InboxItemsRepository, 'findById'> = {
  findById: vi.fn().mockResolvedValue(fakeInbox),
};

const fakeClarificationsRepo: Pick<
  ClarificationsRepository,
  'listPendingForTelegramChat'
> = {
  listPendingForTelegramChat: vi.fn().mockResolvedValue([]),
};

function makeFakeTasksRepo(behavior: 'ok' | 'throw' | 'no_data' = 'ok'): TasksRepository {
  return {
    listActiveByInboxItemIds: vi.fn().mockImplementation(async () => {
      if (behavior === 'throw') throw new Error('db down');
      if (behavior === 'no_data') return [];
      return [
        {
          id: 'task_1',
          title: 'Corrigir os pontos do projeto Miranda',
          status: 'open',
          due_at: '2026-06-07T00:00:00.000Z',
          inbox_item_id: 'inbox_1',
          created_at: '2026-06-07T09:00:00Z',
          // ... outros campos opcionais
        } as never,
      ];
    }),
  } as unknown as TasksRepository;
}

function makeFakeThreadCtx(
  recent: Array<{ inboxItemId: string; rawContent: string; createdAt: string }> = [],
): ThreadConversationContextService {
  return {
    buildForThread: vi.fn().mockResolvedValue({
      threadId: 'telegram:1',
      recentMessages: recent,
      salientEntities: [],
    }),
  } as unknown as ThreadConversationContextService;
}

describe('buildReasonerContext — activeTasks', () => {
  it('popula activeTasks com tasks reais do thread', async () => {
    const tasksRepo = makeFakeTasksRepo('ok');
    const threadCtx = makeFakeThreadCtx();

    const out = await buildReasonerContext({
      inboxId: 'inbox_1',
      threadId: 'telegram:1',
      chatId: 123,
      currentMessage: 'msg',
      channel: 'telegram',
      receivedAt: '2026-06-07T10:00:00Z',
      timezone: 'America/Sao_Paulo',
      inboxRepo: fakeInboxRepo as InboxItemsRepository,
      clarificationsRepo: fakeClarificationsRepo as ClarificationsRepository,
      tasksRepo,
      threadContextService: threadCtx,
      answeredSlices: [],
    });

    expect(out.activeTasks).toHaveLength(1);
    expect(out.activeTasks[0].title).toContain('Miranda');
    expect(tasksRepo.listActiveByInboxItemIds).toHaveBeenCalledWith(
      expect.arrayContaining(['inbox_1']),
      20,
    );
  });

  it('retorna [] se tasksRepo ausente (Reasoner ainda funciona)', async () => {
    const out = await buildReasonerContext({
      inboxId: 'inbox_1',
      threadId: 'telegram:1',
      chatId: 123,
      currentMessage: 'msg',
      channel: 'telegram',
      receivedAt: '2026-06-07T10:00:00Z',
      timezone: 'America/Sao_Paulo',
      inboxRepo: fakeInboxRepo as InboxItemsRepository,
      clarificationsRepo: fakeClarificationsRepo as ClarificationsRepository,
      tasksRepo: null,
      threadContextService: makeFakeThreadCtx(),
      answeredSlices: [],
    });

    expect(out.activeTasks).toEqual([]);
  });

  it('engole erro do tasksRepo e retorna [] (não bloqueia Reasoner)', async () => {
    const out = await buildReasonerContext({
      inboxId: 'inbox_1',
      threadId: 'telegram:1',
      chatId: 123,
      currentMessage: 'msg',
      channel: 'telegram',
      receivedAt: '2026-06-07T10:00:00Z',
      timezone: 'America/Sao_Paulo',
      inboxRepo: fakeInboxRepo as InboxItemsRepository,
      clarificationsRepo: fakeClarificationsRepo as ClarificationsRepository,
      tasksRepo: makeFakeTasksRepo('throw'),
      threadContextService: makeFakeThreadCtx(),
      answeredSlices: [],
    });

    expect(out.activeTasks).toEqual([]);
  });

  it('inclui inboxes do thread + inbox atual na query', async () => {
    const tasksRepo = makeFakeTasksRepo('no_data');
    const threadCtx = makeFakeThreadCtx([
      { inboxItemId: 'inbox_0', rawContent: 'msg anterior', createdAt: '2026-06-07T09:00:00Z' },
      { inboxItemId: 'inbox_neg1', rawContent: 'mais antiga', createdAt: '2026-06-07T08:00:00Z' },
    ]);

    await buildReasonerContext({
      inboxId: 'inbox_1',
      threadId: 'telegram:1',
      chatId: 123,
      currentMessage: 'msg',
      channel: 'telegram',
      receivedAt: '2026-06-07T10:00:00Z',
      timezone: 'America/Sao_Paulo',
      inboxRepo: fakeInboxRepo as InboxItemsRepository,
      clarificationsRepo: fakeClarificationsRepo as ClarificationsRepository,
      tasksRepo,
      threadContextService: threadCtx,
      answeredSlices: [],
    });

    const calledWith = (tasksRepo.listActiveByInboxItemIds as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string[];
    expect(calledWith).toContain('inbox_1');
    expect(calledWith).toContain('inbox_0');
    expect(calledWith).toContain('inbox_neg1');
  });
});
