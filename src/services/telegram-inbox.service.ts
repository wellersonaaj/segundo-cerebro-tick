import { isGreenfieldSchemaEnabled } from '../config/env.js';
import { requireTelegramConfig } from '../config/telegram.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ProcessInboxResult } from '../types/domain.js';
import { formatClarificationPrompt } from '../telegram/format-clarification-prompt.js';
import {
  isNewCaptureIntent,
  parseClarificationAnswer,
  stripNewCapturePrefix,
} from '../telegram/parse-clarification-answer.js';
import type { ParsedTelegramCapture } from '../telegram/parse-update.js';
import { sendTelegramMessage } from '../telegram/telegram-bot.client.js';
import type { ClarificationRequest } from '../types/domain.js';
import type { InboxItemRow } from '../repositories/inbox-items.repository.js';
import {
  isTelegramPromptableClarification,
  withTelegramClarificationState,
} from '../telegram/telegram-metadata.js';
import type { ClarificationService } from './clarification.service.js';
import type { InboxItemProcessService } from './inbox-item-process.service.js';
import type { InboxProcessorService } from './inbox-processor.service.js';
import { TelegramClarificationQueueService } from './telegram-clarification-queue.service.js';

export function buildTelegramInboxMetadata(
  capture: ParsedTelegramCapture,
  senderEntityReference: string | null,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    telegram: {
      user_id: capture.userId,
      chat_id: capture.chatId,
      message_id: capture.messageId,
    },
    source_metadata: {
      entityLike: senderEntityReference ? { sender_reference: senderEntityReference } : {},
      routing: { thread_reference: `telegram:chat:${capture.chatId}` },
    },
  };
  return metadata;
}

export function formatTelegramProcessReply(result: ProcessInboxResult): string {
  const lines = [
    'Captura registrada.',
    `ID: ${result.inbox_item_id.slice(0, 8)}…`,
    `Status: ${result.processing_status}`,
    `Clarificações pendentes: ${result.clarifications_pending}`,
  ];
  if (result.requires_review) {
    lines.push('Revisão sugerida pelo pipeline.');
  }
  return lines.join('\n');
}

export type TelegramHandleResult =
  | { kind: 'capture'; result: ProcessInboxResult }
  | { kind: 'clarification_resolved'; answer: string; inbox_item_id: string };

export class TelegramInboxService {
  private readonly clarificationQueue: TelegramClarificationQueueService | null;

  constructor(
    private readonly processor: InboxProcessorService,
    private readonly inboxRepo: InboxItemsRepository,
    private readonly v14Process: InboxItemProcessService | null = null,
    private readonly clarificationsRepo: ClarificationsRepository | null = null,
    private readonly clarificationService: ClarificationService | null = null,
  ) {
    this.clarificationQueue = clarificationsRepo
      ? new TelegramClarificationQueueService(inboxRepo, clarificationsRepo)
      : null;
  }

  async handleIncoming(capture: ParsedTelegramCapture): Promise<TelegramHandleResult> {
    const text = capture.text.trim();
    const forceNewCapture = isNewCaptureIntent(text);
    const captureText = forceNewCapture ? stripNewCapturePrefix(text) : text;

    if (!forceNewCapture) {
      const resolved = await this.tryResolveClarification(capture, captureText);
      if (resolved) return resolved;
    }

    if (!captureText.trim()) {
      throw new Error('Empty message after stripping nova: prefix');
    }

    const result = await this.ingestCapture({ ...capture, text: captureText });
    return { kind: 'capture', result };
  }

  private async tryResolveClarification(
    capture: ParsedTelegramCapture,
    text: string,
  ): Promise<TelegramHandleResult | null> {
    if (!this.clarificationService || !this.clarificationsRepo || !this.clarificationQueue) {
      return null;
    }

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
    const applyResult = await this.clarificationService.resolveAndApply(ctx.clarification.id, answer, {
      apply: true,
    });

    await this.clearClarificationPrompt(ctx.inbox.id);
    await this.notifyClarificationResolved(capture.chatId, answer);
    await this.promptNextClarification(capture.chatId);

    return {
      kind: 'clarification_resolved',
      answer,
      inbox_item_id: applyResult.inbox_item_id,
    };
  }

  async ingestCapture(capture: ParsedTelegramCapture): Promise<ProcessInboxResult> {
    const config = requireTelegramConfig();

    if (isGreenfieldSchemaEnabled() && this.v14Process) {
      const metadata = buildTelegramInboxMetadata(capture, config.senderEntityReference);
      const inboxItem = await this.inboxRepo.create({
        raw_content: capture.text,
        source_channel: 'telegram',
        source_mode: 'conversational',
        received_at: capture.receivedAt,
        timezone: config.defaultTimezone,
        source_reference: `telegram:chat:${capture.chatId}:message:${capture.messageId}`,
        metadata,
      });
      const v14 = await this.v14Process.processById(inboxItem.id);
      const pendingCount = this.clarificationsRepo
        ? (await this.clarificationsRepo.listPendingByInboxItem(inboxItem.id)).length
        : v14.needs_clarification
          ? 1
          : 0;
      return {
        inbox_item_id: inboxItem.id,
        extraction_run_id: v14.extraction_run_id ?? '',
        processing_status: v14.processing_status,
        has_active_memory: v14.processing_status === 'completed',
        extractor_version: v14.extractor_version ?? 'extractor-v1.4',
        entities_created: 0,
        entities_resolved: 0,
        events_created: 0,
        assertions_created: 0,
        tasks_created: 0,
        clarifications_pending: pendingCount,
        clarifications_resolved_automatically: 0,
        requires_review: pendingCount > 0,
        review_reasons: [],
        processing_notes: [],
      };
    }

    return this.processor.process({
      raw_content: capture.text,
      source_channel: 'telegram',
      source_mode: 'conversational',
      received_at: capture.receivedAt,
      timezone: config.defaultTimezone,
      source_reference: `telegram:chat:${capture.chatId}:message:${capture.messageId}`,
      metadata: buildTelegramInboxMetadata(capture, config.senderEntityReference),
    });
  }

  async ingestAndNotify(capture: ParsedTelegramCapture): Promise<TelegramHandleResult> {
    const config = requireTelegramConfig();
    const handled = await this.handleIncoming(capture);

    try {
      if (handled.kind === 'capture') {
        await sendTelegramMessage(config, capture.chatId, formatTelegramProcessReply(handled.result));
        await this.promptNextClarification(capture.chatId, handled.result.inbox_item_id);
      }
    } catch {
      // Resposta no chat é best-effort; a captura já foi persistida.
    }

    return handled;
  }

  private async notifyClarificationResolved(chatId: number, answer: string): Promise<void> {
    const config = requireTelegramConfig();
    const preview = answer.length > 120 ? `${answer.slice(0, 119)}…` : answer;
    await sendTelegramMessage(config, chatId, `Registrado: ${preview}`);
  }

  async promptNextClarification(chatId: number, inboxItemId?: string): Promise<void> {
    if (!this.clarificationsRepo || !this.clarificationQueue) return;

    const active = await this.clarificationQueue.findActiveClarificationForChat(chatId);
    if (active) return;

    const config = requireTelegramConfig();
    let ctx = inboxItemId ? await this.findPromptableForInbox(inboxItemId) : null;

    if (!ctx) {
      ctx = await this.clarificationQueue.findOldestPendingForChat(chatId);
    }

    if (!ctx) return;

    const prompt = formatClarificationPrompt(ctx.clarification);
    const promptMessageId = await sendTelegramMessage(config, chatId, prompt);
    await this.inboxRepo.updateMetadata(
      ctx.inbox.id,
      withTelegramClarificationState(ctx.inbox.metadata ?? null, {
        active_clarification_id: ctx.clarification.id,
        prompt_message_id: promptMessageId,
      }),
    );
  }

  private async findPromptableForInbox(inboxItemId: string): Promise<{
    clarification: ClarificationRequest;
    inbox: InboxItemRow;
  } | null> {
    if (!this.clarificationsRepo) return null;
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) return null;
    const pending = await this.clarificationsRepo.listPendingByInboxItem(inboxItemId);
    const clarification = pending.find((c) => isTelegramPromptableClarification(c));
    if (!clarification) return null;
    return { clarification, inbox };
  }

  private async clearClarificationPrompt(inboxItemId: string): Promise<void> {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) return;
    await this.inboxRepo.updateMetadata(
      inboxItemId,
      withTelegramClarificationState(inbox.metadata ?? null, null),
    );
  }
}
