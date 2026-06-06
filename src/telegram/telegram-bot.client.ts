/* global fetch */
import type { TelegramConfig } from '../config/telegram.js';
import { log } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramSendOptions {
  parse_mode?: 'Markdown';
  reply_markup?: TelegramReplyMarkup;
  disable_web_page_preview?: boolean;
}

/**
 * Telegram API errors that should NOT be retried:
 * - 4xx (client errors): bad chat_id, bot blocked, message too long, etc.
 *   Retrying won't fix these and floods logs.
 * - 400 Bad Request, 403 Forbidden, 404 Not Found, 429 Too Many Requests (let
 *   Telegram's own rate limit logic handle via backoff via withRetry? we still
 *   retry 429 because it's transient). 401 Unauthorized is a config bug — surface it.
 */
function isRetryableTelegramError(status: number | undefined): boolean {
  if (status === undefined) return true; // network error
  if (status === 429) return true; // rate limit
  if (status >= 500) return true; // server
  return false; // 4xx
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly method?: string,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

async function callTelegramApi<T>(
  config: TelegramConfig,
  method: string,
  body?: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<TelegramApiResponse<T>> {
  const url = `https://api.telegram.org/bot${config.botToken}/${method}`;

  return withRetry(
    async () => {
      let res: Response;
      let data: TelegramApiResponse<T>;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        data = (await res.json()) as TelegramApiResponse<T>;
      } catch (err) {
        // Network-level failure (DNS, ECONNRESET, etc) — mark as retryable
        const message = err instanceof Error ? err.message : String(err);
        const e = new TelegramApiError(`TELEGRAM_NETWORK_ERROR: ${message}`, undefined, method);
        log('warn', 'telegram_send', {
          step: 'network_error',
          method,
          error: message,
        });
        throw e;
      }

      if (!res.ok || !data.ok) {
        const detail = data.description ?? `HTTP ${res.status}`;
        const e = new TelegramApiError(
          `TELEGRAM_API_ERROR: ${detail}`,
          res.status,
          method,
        );
        if (!isRetryableTelegramError(res.status)) {
          log('error', 'telegram_send', {
            step: 'permanent_error',
            method,
            status: res.status,
            detail,
            chat_id: body?.chat_id,
          });
        }
        throw e;
      }
      return data;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      isRetryable: (err) => {
        if (err instanceof TelegramApiError) {
          return isRetryableTelegramError(err.status);
        }
        return true; // unknown — default retry
      },
      onRetry: (attempt, err, delay) => {
        log('warn', 'telegram_send', {
          step: 'retry',
          method,
          attempt,
          delay_ms: delay,
          status: err instanceof TelegramApiError ? err.status : undefined,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    },
  );
}

export async function setTelegramWebhook(config: TelegramConfig): Promise<void> {
  await callTelegramApi(config, 'setWebhook', {
    url: config.webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
  });
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  chatId: number,
  text: string,
  options?: TelegramSendOptions,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const data = await callTelegramApi<{ message_id: number }>(
    config,
    'sendMessage',
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: options?.disable_web_page_preview ?? true,
      ...(options?.parse_mode ? { parse_mode: options.parse_mode } : {}),
      ...(options?.reply_markup ? { reply_markup: options.reply_markup } : {}),
    },
    fetchFn,
  );
  return data.result!.message_id;
}

export async function editTelegramMessageText(
  config: TelegramConfig,
  chatId: number,
  messageId: number,
  text: string,
  options?: Pick<TelegramSendOptions, 'parse_mode' | 'reply_markup'>,
): Promise<void> {
  await callTelegramApi(config, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...(options?.parse_mode ? { parse_mode: options.parse_mode } : {}),
    ...(options?.reply_markup ? { reply_markup: options.reply_markup } : {}),
  });
}

export async function answerTelegramCallbackQuery(
  config: TelegramConfig,
  callbackQueryId: string,
): Promise<void> {
  await callTelegramApi(config, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
  });
}
