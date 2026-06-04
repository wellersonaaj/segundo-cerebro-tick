import { requireTelegramConfig } from '../config/telegram.js';
import type { ProcessInboxResult } from '../types/domain.js';
import type { ParsedTelegramCapture } from '../telegram/parse-update.js';
import { sendTelegramMessage } from '../telegram/telegram-bot.client.js';
import type { InboxProcessorService } from './inbox-processor.service.js';

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
  constructor(private readonly processor: InboxProcessorService) {}

  async ingestCapture(capture: ParsedTelegramCapture): Promise<ProcessInboxResult> {
    const config = requireTelegramConfig();
    return this.processor.process({
      raw_content: capture.text,
      source_channel: 'telegram',
      source_mode: 'conversational',
      received_at: capture.receivedAt,
      timezone: config.defaultTimezone,
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
