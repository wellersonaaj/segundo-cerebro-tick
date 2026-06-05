import { requireTelegramConfig } from '../config/telegram.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import {
  isNewCaptureIntent,
  looksLikeClarificationAnswer,
  parseClarificationAnswer,
  stripNewCapturePrefix,
} from '../telegram/parse-clarification-answer.js';
import type { ParsedTelegramCapture } from '../telegram/parse-update.js';
import { buildTelegramSourceReference } from '../telegram/telegram-source-reference.js';
import { createTelegramDelivery } from './assistant-delivery.js';
import type { UnifiedRouterService } from './unified-router.service.js';
import type { AssistantTurnService } from './assistant-turn.service.js';
import { AssistantTurnService as AssistantTurnServiceClass } from './assistant-turn.service.js';
import {
  logClarificationLookup,
  TelegramClarificationQueueService,
  type ClarificationLookupTraceEntry,
} from './telegram-clarification-queue.service.js';
import { getCurrentTurn } from '../utils/turn-context.js';

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
    private readonly unifiedRouter: UnifiedRouterService,
    private readonly assistantTurn: AssistantTurnService,
    clarificationsRepo: ClarificationsRepository | null = null,
  ) {
    this.clarificationQueue = clarificationsRepo
      ? new TelegramClarificationQueueService(inboxRepo, clarificationsRepo)
      : null;
  }

  async handleIncoming(capture: ParsedTelegramCapture): Promise<TelegramHandleResult> {
    const config = requireTelegramConfig();
    const turn = getCurrentTurn();
    const text = capture.text.trim();
    const forceNewCapture = isNewCaptureIntent(text);
    const captureText = forceNewCapture ? stripNewCapturePrefix(text) : text;

    await turn?.handle.stage('parse', {
      output: {
        forced_new: forceNewCapture,
        text_length: captureText.length,
        has_reply: capture.replyToMessageId != null,
      },
    });

    const threadId = AssistantTurnServiceClass.threadIdForTelegramChat(capture.chatId);

    await turn?.handle.stage('thread_resolve', {
      output: { thread_id: threadId },
    });

    const delivery = createTelegramDelivery(config, capture.chatId, {
      message_id: capture.messageId,
    });

    if (!forceNewCapture) {
      const shouldResolve = await this.shouldTryResolveClarification(capture, captureText);
      await turn?.handle.stage('clarification_check', {
        output: shouldResolve.will_try_resolve
          ? { forced_new: false, will_try_resolve: true }
          : {
              forced_new: false,
              will_try_resolve: false,
              reason: shouldResolve.reason ?? 'not_answer_shape',
            },
      });

      if (shouldResolve.will_try_resolve) {
        const resolved = await this.tryResolveClarification(capture, captureText, threadId, delivery);
        if (resolved) return resolved;
      }
    } else {
      await turn?.handle.stage('clarification_check', {
        output: { forced_new: true, will_try_resolve: false },
      });
    }

    if (!captureText.trim()) {
      throw new Error('Empty message after stripping nova: prefix');
    }

    const routerResult = await this.unifiedRouter.handle({
      capture,
      text: captureText,
      threadId,
      delivery,
      receivedAt: capture.receivedAt,
      timezone: config.defaultTimezone,
      sourceReference: buildTelegramSourceReference(capture.chatId, capture.messageId),
      metadata: buildTelegramInboxMetadata(
        { ...capture, text: captureText },
        config.senderEntityReference,
      ),
    });

    if (routerResult.kind === 'sync_reply') {
      const sendStart = Date.now();
      await delivery.sendFollowUp(routerResult.text);
      await turn?.handle.stage('send', {
        output: {
          message_length: routerResult.text.length,
          latency_send_ms: Date.now() - sendStart,
        },
      });
      return {
        kind: 'async_started',
        turn_id: turn?.turn_id ?? 'sync',
        thread_id: threadId,
      };
    }

    return {
      kind: 'async_started',
      turn_id: routerResult.turn_id,
      thread_id: routerResult.thread_id,
    };
  }

  private async shouldTryResolveClarification(
    capture: ParsedTelegramCapture,
    text: string,
  ): Promise<{ will_try_resolve: boolean; reason?: string }> {
    if (!this.clarificationQueue) {
      return { will_try_resolve: false, reason: 'no_clarification_queue' };
    }

    if (capture.replyToMessageId != null) {
      const byReply = await this.clarificationQueue.findByPromptMessageId(
        capture.chatId,
        capture.replyToMessageId,
      );
      if (byReply) return { will_try_resolve: true };
    }

    if (looksLikeClarificationAnswer(text)) {
      return { will_try_resolve: true };
    }

    return { will_try_resolve: false, reason: 'not_answer_shape' };
  }

  private async tryResolveClarification(
    capture: ParsedTelegramCapture,
    text: string,
    threadId: string,
    delivery: ReturnType<typeof createTelegramDelivery>,
  ): Promise<TelegramHandleResult | null> {
    if (!this.clarificationQueue) return null;

    const trace: ClarificationLookupTraceEntry[] = [];
    const ctx = await this.clarificationQueue.findPendingClarificationForChat(capture.chatId, {
      replyToMessageId: capture.replyToMessageId,
      trace,
    });
    logClarificationLookup(capture.chatId, text, trace, ctx);

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
