import { requireTelegramConfig } from '../config/telegram.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import {
  isNewCaptureIntent,
  parseClarificationAnswer,
  stripNewCapturePrefix,
} from '../telegram/parse-clarification-answer.js';
import type { ParsedTelegramCapture } from '../telegram/parse-update.js';
import { buildTelegramSourceReference } from '../telegram/telegram-source-reference.js';
import { createTelegramDelivery } from './assistant-delivery.js';
import type { AssistantTurnService } from './assistant-turn.service.js';
import { AssistantTurnService as AssistantTurnServiceClass } from './assistant-turn.service.js';
import { TelegramClarificationQueueService } from './telegram-clarification-queue.service.js';

export function buildTelegramInboxMetadata(
  capture: ParsedTelegramCapture,
  senderEntityReference: string | null,
): Record<string, unknown> {
  const threadId = AssistantTurnServiceClass.threadIdForTelegramChat(capture.chatId);
  const metadata: Record<string, unknown> = {
    telegram: {
      user_id: capture.userId,
      chat_id: capture.chatId,
      message_id: capture.messageId,
    },
    assistant: {
      thread_id: threadId,
    },
    source_metadata: {
      entityLike: senderEntityReference ? { sender_reference: senderEntityReference } : {},
      routing: { thread_reference: threadId },
    },
  };
  return metadata;
}

export type TelegramHandleResult =
  | { kind: 'async_started'; turn_id: string; thread_id: string }
  | { kind: 'clarification_resolved'; turn_id: string; answer: string; inbox_item_id: string };

export class TelegramInboxService {
  private readonly clarificationQueue: TelegramClarificationQueueService | null;

  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly assistantTurn: AssistantTurnService,
    clarificationsRepo: ClarificationsRepository | null = null,
  ) {
    this.clarificationQueue = clarificationsRepo
      ? new TelegramClarificationQueueService(inboxRepo, clarificationsRepo)
      : null;
  }

  async handleIncoming(capture: ParsedTelegramCapture): Promise<TelegramHandleResult> {
    const config = requireTelegramConfig();
    const text = capture.text.trim();
    const forceNewCapture = isNewCaptureIntent(text);
    const captureText = forceNewCapture ? stripNewCapturePrefix(text) : text;
    const threadId = AssistantTurnServiceClass.threadIdForTelegramChat(capture.chatId);
    const delivery = createTelegramDelivery(config, capture.chatId, {
      message_id: capture.messageId,
    });

    if (!forceNewCapture) {
      const resolved = await this.tryResolveClarification(capture, captureText, threadId, delivery);
      if (resolved) return resolved;
    }

    if (!captureText.trim()) {
      throw new Error('Empty message after stripping nova: prefix');
    }

    const ack = await this.assistantTurn.startCapture({
      text: captureText,
      thread_id: threadId,
      channel: 'telegram',
      received_at: capture.receivedAt,
      timezone: config.defaultTimezone,
      source_reference: buildTelegramSourceReference(capture.chatId, capture.messageId),
      metadata: buildTelegramInboxMetadata(
        { ...capture, text: captureText },
        config.senderEntityReference,
      ),
      delivery,
    });

    return { kind: 'async_started', turn_id: ack.turn_id, thread_id: ack.thread_id };
  }

  private async tryResolveClarification(
    capture: ParsedTelegramCapture,
    text: string,
    threadId: string,
    delivery: ReturnType<typeof createTelegramDelivery>,
  ): Promise<TelegramHandleResult | null> {
    if (!this.clarificationQueue) return null;

    let ctx =
      capture.replyToMessageId != null
        ? await this.clarificationQueue.findByPromptMessageId(
            capture.chatId,
            capture.replyToMessageId,
          )
        : null;

    if (!ctx) {
      const active = await this.clarificationQueue.findActiveClarificationForChat(capture.chatId);
      if (active) ctx = active;
    }

    if (!ctx) return null;

    const answer = parseClarificationAnswer(text, ctx.clarification.suggested_answers ?? []);
    const ack = await this.assistantTurn.resolveClarification({
      clarification_id: ctx.clarification.id,
      inbox_item_id: ctx.inbox.id,
      answer,
      thread_id: threadId,
      channel: 'telegram',
      delivery,
      chat_id: capture.chatId,
    });

    return {
      kind: 'clarification_resolved',
      turn_id: ack.turn_id,
      answer,
      inbox_item_id: ctx.inbox.id,
    };
  }
}
