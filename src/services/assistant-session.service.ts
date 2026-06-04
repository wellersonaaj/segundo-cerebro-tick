import type { InboxItemRow, InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { TasksRepository } from '../repositories/tasks.repository.js';
import type { ClarificationRequest, Task } from '../types/domain.js';
import { getTelegramChatId } from '../telegram/telegram-metadata.js';

export function buildAssistantThreadId(channel: 'telegram' | 'api', key: string): string {
  if (channel === 'telegram') return `telegram:chat:${key}`;
  return key.startsWith('api:') ? key : `api:${key}`;
}

export function resolveThreadIdFromInbox(
  inbox: Pick<InboxItemRow, 'metadata' | 'source_channel'>,
): string | null {
  const meta = inbox.metadata ?? null;
  const assistant = meta?.assistant;
  if (assistant && typeof assistant === 'object') {
    const tid = (assistant as { thread_id?: unknown }).thread_id;
    if (typeof tid === 'string' && tid.trim()) return tid;
  }
  const routing = (meta?.source_metadata as { routing?: { thread_reference?: string } } | undefined)
    ?.routing;
  if (routing?.thread_reference?.trim()) return routing.thread_reference.trim();
  const chatId = getTelegramChatId(meta);
  if (chatId != null) return buildAssistantThreadId('telegram', String(chatId));
  return null;
}

export function withAssistantTurnMetadata(
  metadata: Record<string, unknown> | null | undefined,
  patch: {
    thread_id: string;
    active_turn_id?: string | null;
  },
): Record<string, unknown> {
  const base = { ...(metadata ?? {}) };
  const assistant: Record<string, unknown> = {
    ...((base.assistant as Record<string, unknown> | undefined) ?? {}),
    thread_id: patch.thread_id,
  };
  if (patch.active_turn_id === null) {
    delete assistant.active_turn_id;
  } else if (patch.active_turn_id) {
    assistant.active_turn_id = patch.active_turn_id;
  }
  base.assistant = assistant;
  if (!base.source_metadata || typeof base.source_metadata !== 'object') {
    base.source_metadata = {};
  }
  const sm = base.source_metadata as Record<string, unknown>;
  if (!sm.routing || typeof sm.routing !== 'object') sm.routing = {};
  (sm.routing as Record<string, unknown>).thread_reference = patch.thread_id;
  return base;
}

export class AssistantSessionService {
  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly clarificationsRepo: ClarificationsRepository,
    private readonly tasksRepo: TasksRepository,
  ) {}

  async listRecentInboxesForThread(threadId: string, limit = 10): Promise<InboxItemRow[]> {
    const recent = await this.inboxRepo.listRecent({ limit: 100 });
    return recent
      .filter((row) => this.resolveThreadId(row) === threadId)
      .slice(0, limit);
  }

  resolveThreadId(inbox: InboxItemRow): string | null {
    return resolveThreadIdFromInbox(inbox);
  }

  async listOpenTasksSnapshot(limit = 10): Promise<Task[]> {
    return this.tasksRepo.listOpen(undefined, limit);
  }

  async listPendingClarificationsForThread(threadId: string): Promise<ClarificationRequest[]> {
    const inboxes = await this.listRecentInboxesForThread(threadId, 20);
    if (!inboxes.length) return [];
    const all: ClarificationRequest[] = [];
    for (const inbox of inboxes) {
      const pending = await this.clarificationsRepo.listPendingByInboxItem(inbox.id);
      all.push(...pending);
    }
    return all;
  }
}
