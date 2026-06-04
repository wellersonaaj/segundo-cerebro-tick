import { isGreenfieldSchemaEnabled } from '../config/env.js';
import { requireTelegramConfig } from '../config/telegram.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ProcessInboxResult } from '../types/domain.js';
import type { ParsedTelegramCapture } from '../telegram/parse-update.js';
import { sendTelegramMessage } from '../telegram/telegram-bot.client.js';
import type { InboxItemProcessService } from './inbox-item-process.service.js';
import type { InboxProcessorService } from './inbox-processor.service.js';

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

export class TelegramInboxService {
  constructor(
    private readonly processor: InboxProcessorService,
    private readonly inboxRepo: InboxItemsRepository,
    private readonly v14Process: InboxItemProcessService | null = null,
  ) {}

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
        clarifications_pending: v14.needs_clarification ? 1 : 0,
        clarifications_resolved_automatically: 0,
        requires_review: v14.needs_clarification ?? false,
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

  async ingestAndNotify(capture: ParsedTelegramCapture): Promise<ProcessInboxResult> {
    const config = requireTelegramConfig();
    const result = await this.ingestCapture(capture);
    try {
      await sendTelegramMessage(
        config,
        capture.chatId,
        formatTelegramProcessReply(result),
      );
    } catch {
      // Resposta no chat é best-effort; a captura já foi persistida.
    }
    return result;
  }
}
