import type { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { TasksRepository } from '../repositories/tasks.repository.js';
import type { ThreadConversationContextService } from './thread-conversation-context.service.js';
import type {
  ActiveTask,
  PendingClarification,
  ReasonInput,
  ThreadContext,
} from './contextual-reasoner.types.js';
import { isTelegramPromptableClarification } from '../telegram/telegram-metadata.js';
import { log } from '../utils/logger.js';

/**
 * Constrói o ReasonInput a partir de inbox + thread context.
 *
 * Fontes:
 * 1. Clarifs pendentes do chat (todas as threads ativas, filtradas por isTelegramPromptable)
 * 2. Thread context (últimas 3 msgs do mesmo thread + entities salientes)
 * 3. Tasks ativas (open/in_progress) — opcional, Fase 5.2 pode injetar
 */
export async function buildReasonerContext(params: {
  inboxId: string;
  threadId: string;
  chatId: number | null;
  currentMessage: string;
  channel: 'telegram' | 'api';
  receivedAt: string;
  timezone: string;
  inboxRepo: InboxItemsRepository;
  clarificationsRepo: ClarificationsRepository;
  threadContextService: ThreadConversationContextService | null;
  answeredSlices: Array<{
    question: string;
    answer: string;
  }>;
}): Promise<ReasonInput> {
  // 1. Clarifs pendentes do chat
  const pendingClarifications: PendingClarification[] = await listPendingClarifications(
    params,
  );

  // 2. Thread context (últimas 3 msgs + entities)
  const threadContext: ThreadContext = await buildThreadContext(params);

  // 3. Active tasks — best-effort. Por enquanto, sem tasksRepo dedicado
  //    no AssistantTurnService. Pode ser injetado na Fase 5.2.
  const activeTasks: ActiveTask[] = [];

  return {
    currentMessage: params.currentMessage,
    channel: params.channel,
    receivedAt: params.receivedAt,
    timezone: params.timezone,
    pendingClarifications,
    threadContext,
    activeTasks,
  };
}

async function listPendingClarifications(params: {
  inboxId: string;
  inboxRepo: InboxItemsRepository;
  clarificationsRepo: ClarificationsRepository;
  chatId: number | null;
  threadContextService: ThreadConversationContextService | null;
  threadId: string;
  answeredSlices: Array<{ question: string; answer: string }>;
}): Promise<PendingClarification[]> {
  // Coletar IDs de inbox do thread atual (não só o atual)
  const inboxIds: string[] = [params.inboxId];
  if (params.threadContextService) {
    try {
      const ctx = await params.threadContextService.buildForThread(params.threadId);
      if (ctx) {
        for (const m of ctx.recentMessages) {
          if (!inboxIds.includes(m.inboxItemId)) {
            inboxIds.push(m.inboxItemId);
          }
        }
      }
    } catch (err) {
      log('warn', 'reasoner_context', {
        step: 'thread_context_build_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Buscar clarifs pendentes do chat
  let allPending: Awaited<ReturnType<ClarificationsRepository['listPendingForTelegramChat']>> = [];
  if (params.chatId != null) {
    try {
      allPending = await params.clarificationsRepo.listPendingForTelegramChat(
        params.chatId,
        inboxIds,
      );
    } catch (err) {
      log('warn', 'reasoner_context', {
        step: 'list_pending_clarifs_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Filtrar e mapear
  return allPending
    .filter((c) => isTelegramPromptableClarification(c, params.answeredSlices as never))
    .map((c) => ({
      id: c.id,
      question: c.question,
      issue_type: c.issue_type ?? 'other',
      target_reference: c.target_reference ?? '',
      suggested_answers: c.suggested_answers ?? [],
      source_excerpt: c.source_excerpt ?? '',
      inbox_item_id: c.inbox_item_id,
    }));
}

async function buildThreadContext(params: {
  threadId: string;
  chatId: number | null;
  threadContextService: ThreadConversationContextService | null;
}): Promise<ThreadContext> {
  if (!params.threadContextService) {
    return { thread_id: params.threadId, recentMessages: [], salientEntities: [] };
  }
  try {
    const ctx = await params.threadContextService.buildForThread(params.threadId);
    if (!ctx) {
      return { thread_id: params.threadId, recentMessages: [], salientEntities: [] };
    }
    return {
      thread_id: params.threadId,
      recentMessages: ctx.recentMessages.map((m) => ({
        inbox_item_id: m.inboxItemId,
        raw_content: m.rawContent,
        created_at: m.createdAt,
      })),
      salientEntities: ctx.salientEntities.map((e) => ({
        reference: e.reference,
        canonicalName: e.canonicalName,
        entityType: e.entityType,
      })),
    };
  } catch (err) {
    log('warn', 'reasoner_context', {
      step: 'build_thread_context_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return { thread_id: params.threadId, recentMessages: [], salientEntities: [] };
  }
}

