/* global fetch */
import type { TelegramConfig } from '../config/telegram.js';

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callTelegramApi<T>(
  config: TelegramConfig,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  const url = `https://api.telegram.org/bot${config.botToken}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!res.ok || !data.ok) {
    const detail = data.description ?? `HTTP ${res.status}`;
    throw new Error(`TELEGRAM_API_ERROR: ${detail}`);
  }
  return data;
}

export async function setTelegramWebhook(config: TelegramConfig): Promise<void> {
  await callTelegramApi(config, 'setWebhook', {
    url: config.webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: false,
  });
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  chatId: number,
  text: string,
): Promise<void> {
  await callTelegramApi(config, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}
