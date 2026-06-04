import type { TelegramConfig } from '../config/telegram.js';
import { sendTelegramMessage } from '../telegram/telegram-bot.client.js';
import { log } from '../utils/logger.js';
import type { AssistantDelivery } from './assistant-turn.types.js';

export async function sendTelegramMessageSafe(
  config: TelegramConfig,
  chatId: number,
  text: string,
  context?: Record<string, unknown>,
): Promise<number | null> {
  try {
    const messageId = await sendTelegramMessage(config, chatId, text);
    log('info', 'telegram_send', { step: 'sent', chat_id: chatId, message_id: messageId, ...context });
    return messageId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'telegram_send', { step: 'failed', chat_id: chatId, error: message, ...context });
    return null;
  }
}

export function createTelegramDelivery(
  config: TelegramConfig,
  chatId: number,
  context?: Record<string, unknown>,
): AssistantDelivery {
  return {
    async sendAck(message: string): Promise<void> {
      await sendTelegramMessageSafe(config, chatId, message, { ...context, phase: 'ack' });
    },
    async sendFollowUp(message: string): Promise<number | null> {
      return sendTelegramMessageSafe(config, chatId, message, { ...context, phase: 'follow_up' });
    },
  };
}

export function createNoOpDelivery(): AssistantDelivery {
  return {
    async sendAck(): Promise<void> {},
    async sendFollowUp(): Promise<null> {
      return null;
    },
  };
}
