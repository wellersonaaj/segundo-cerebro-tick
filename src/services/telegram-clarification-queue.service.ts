import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { InboxItemRow, InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ClarificationRequest } from '../types/domain.js';
import {
  getTelegramChatId,
  getTelegramClarificationState,
  isInboxArchived,
  isTelegramPromptableClarification,
} from '../telegram/telegram-metadata.js';
import { log } from '../utils/logger.js';

export interface PendingClarificationContext {
  clarification: ClarificationRequest;
  inbox: InboxItemRow;
}

export interface ClarificationLookupTraceEntry {
  step: string;
  result: 'hit' | 'miss' | 'skip';
  detail?: Record<string, unknown>;
}

export class TelegramClarificationQueueService {
  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly clarificationsRepo: ClarificationsRepository,
  ) {}

  async findOldestPendingForChat(chatId: number): Promise<PendingClarificationContext | null> {
    const inboxes = this.activeTelegramInboxes(await this.inboxRepo.listTelegramByChatId(chatId));
    if (!inboxes.length) return null;

    const inboxById = new Map(inboxes.map((i) => [i.id, i]));
    const pending = await this.clarificationsRepo.listPendingForTelegramChat(
      chatId,
      inboxes.map((i) => i.id),
    );

    for (const c of pending) {
      const ctx = await this.buildPendingContext(chatId, c, inboxById);
      if (ctx) return ctx;
    }
    return null;
  }

  async findNewestPendingForChat(chatId: number): Promise<PendingClarificationContext | null> {
    const inboxes = this.activeTelegramInboxes(await this.inboxRepo.listTelegramByChatId(chatId));
    if (!inboxes.length) return null;

    const inboxById = new Map(inboxes.map((i) => [i.id, i]));
    const pending = await this.clarificationsRepo.listPendingForTelegramChat(
      chatId,
      inboxes.map((i) => i.id),
    );

    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const c = pending[i]!;
      const ctx = await this.buildPendingContext(chatId, c, inboxById);
      if (ctx) return ctx;
    }
    return null;
  }

  async findByPromptMessageId(
    chatId: number,
    promptMessageId: number,
  ): Promise<PendingClarificationContext | null> {
    const inboxes = this.activeTelegramInboxes(await this.inboxRepo.listTelegramByChatId(chatId));
    for (const inbox of inboxes) {
      const state = getTelegramClarificationState(inbox.metadata ?? null);
      if (state?.prompt_message_id !== promptMessageId) continue;
      const clarification = await this.clarificationsRepo.findById(state.active_clarification_id);
      if (!clarification || clarification.status !== 'pending') continue;
      if (getTelegramChatId(inbox.metadata ?? null) !== chatId) continue;
      return { clarification, inbox };
    }
    return null;
  }

  async findByActiveClarificationId(
    chatId: number,
    clarificationId: string,
  ): Promise<PendingClarificationContext | null> {
    const clarification = await this.clarificationsRepo.findById(clarificationId);
    if (!clarification || clarification.status !== 'pending') return null;
    const inbox = await this.inboxRepo.findById(clarification.inbox_item_id);
    if (!inbox || inbox.source_channel !== 'telegram') return null;
    if (isInboxArchived(inbox.metadata ?? null)) return null;
    const state = getTelegramClarificationState(inbox.metadata ?? null);
    if (state?.active_clarification_id !== clarificationId) return null;
    if (getTelegramChatId(inbox.metadata ?? null) !== chatId) return null;
    return { clarification, inbox };
  }

  async findActiveClarificationForChat(chatId: number): Promise<PendingClarificationContext | null> {
    const inboxes = this.activeTelegramInboxes(await this.inboxRepo.listTelegramByChatId(chatId));
    for (const inbox of inboxes) {
      const state = getTelegramClarificationState(inbox.metadata ?? null);
      if (!state) continue;
      const ctx = await this.findByActiveClarificationId(chatId, state.active_clarification_id);
      if (ctx) return ctx;
    }
    return null;
  }

  async findPendingClarificationForChat(
    chatId: number,
    options?: { replyToMessageId?: number | null; trace?: ClarificationLookupTraceEntry[] },
  ): Promise<PendingClarificationContext | null> {
    const trace = options?.trace;

    if (options?.replyToMessageId != null) {
      const byReply = await this.findByPromptMessageId(chatId, options.replyToMessageId);
      trace?.push({
        step: 'findByPromptMessageId',
        result: byReply ? 'hit' : 'miss',
        detail: { prompt_message_id: options.replyToMessageId },
      });
      if (byReply) return byReply;
    }

    const byMetadata = await this.findActiveClarificationForChat(chatId);
    trace?.push({
      step: 'findActiveClarificationForChat',
      result: byMetadata ? 'hit' : 'miss',
    });
    if (byMetadata) return byMetadata;

    const byNewestPending = await this.findNewestPendingForChat(chatId);
    trace?.push({
      step: 'findNewestPendingForChat',
      result: byNewestPending ? 'hit' : 'miss',
      detail: byNewestPending
        ? {
            clarification_id: byNewestPending.clarification.id,
            inbox_item_id: byNewestPending.inbox.id,
          }
        : undefined,
    });
    return byNewestPending;
  }

  private activeTelegramInboxes(inboxes: InboxItemRow[]): InboxItemRow[] {
    return inboxes.filter((inbox) => !isInboxArchived(inbox.metadata ?? null));
  }

  private async buildPendingContext(
    chatId: number,
    clarification: ClarificationRequest,
    inboxById: Map<string, InboxItemRow>,
  ): Promise<PendingClarificationContext | null> {
    const answered = await this.clarificationsRepo.listAnsweredByInboxItem(clarification.inbox_item_id);
    const answeredSlices = answered.map((a) => ({
      question: a.question,
      answer: a.answer ?? '',
      issue_type: a.issue_type,
      target_reference: a.target_reference,
    }));
    if (!isTelegramPromptableClarification(clarification, answeredSlices)) return null;
    const inbox = inboxById.get(clarification.inbox_item_id);
    if (!inbox || getTelegramChatId(inbox.metadata ?? null) !== chatId) return null;
    if (isInboxArchived(inbox.metadata ?? null)) return null;
    return { clarification, inbox };
  }
}

export function logClarificationLookup(
  chatId: number,
  text: string,
  trace: ClarificationLookupTraceEntry[],
  resolved: PendingClarificationContext | null,
): void {
  log('info', 'clarification_lookup', {
    chat_id: chatId,
    text_length: text.length,
    text_preview: text.slice(0, 40),
    resolved: resolved != null,
    clarification_id: resolved?.clarification.id,
    inbox_item_id: resolved?.inbox.id,
    trace,
  });
}
