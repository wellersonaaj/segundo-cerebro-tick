import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { InboxItemRow, InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ClarificationRequest } from '../types/domain.js';
import {
  getTelegramClarificationState,
  isTelegramPromptableClarification,
} from '../telegram/telegram-metadata.js';

export interface PendingClarificationContext {
  clarification: ClarificationRequest;
  inbox: InboxItemRow;
}

export class TelegramClarificationQueueService {
  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly clarificationsRepo: ClarificationsRepository,
  ) {}

  async findOldestPendingForChat(chatId: number): Promise<PendingClarificationContext | null> {
    const inboxes = await this.inboxRepo.listTelegramByChatId(chatId);
    if (!inboxes.length) return null;

    const inboxById = new Map(inboxes.map((i) => [i.id, i]));
    const pending = await this.clarificationsRepo.listPendingForTelegramChat(
      chatId,
      inboxes.map((i) => i.id),
    );

    for (const c of pending) {
      const answered = await this.clarificationsRepo.listAnsweredByInboxItem(c.inbox_item_id);
      const answeredSlices = answered.map((a) => ({
        question: a.question,
        answer: a.answer ?? '',
        issue_type: a.issue_type,
        target_reference: a.target_reference,
      }));
      if (!isTelegramPromptableClarification(c, answeredSlices)) continue;
      const inbox = inboxById.get(c.inbox_item_id);
      if (inbox) return { clarification: c, inbox };
    }
    return null;
  }

  async findByPromptMessageId(
    chatId: number,
    promptMessageId: number,
  ): Promise<PendingClarificationContext | null> {
    const inboxes = await this.inboxRepo.listTelegramByChatId(chatId);
    for (const inbox of inboxes) {
      const state = getTelegramClarificationState(inbox.metadata ?? null);
      if (state?.prompt_message_id !== promptMessageId) continue;
      const clarification = await this.clarificationsRepo.findById(state.active_clarification_id);
      if (!clarification || clarification.status !== 'pending') continue;
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
    const state = getTelegramClarificationState(inbox.metadata ?? null);
    if (state?.active_clarification_id !== clarificationId) return null;
    const metaChatId = (inbox.metadata as { telegram?: { chat_id?: number } } | null)?.telegram
      ?.chat_id;
    if (metaChatId !== chatId) return null;
    return { clarification, inbox };
  }

  async findActiveClarificationForChat(chatId: number): Promise<PendingClarificationContext | null> {
    const inboxes = await this.inboxRepo.listTelegramByChatId(chatId);
    for (const inbox of inboxes) {
      const state = getTelegramClarificationState(inbox.metadata ?? null);
      if (!state) continue;
      const ctx = await this.findByActiveClarificationId(chatId, state.active_clarification_id);
      if (ctx) return ctx;
    }
    return null;
  }
}
