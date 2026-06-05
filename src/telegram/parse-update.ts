import { z } from 'zod';
import { isValidTelegramMessageId } from './telegram-source-reference.js';

const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  username: z.string().optional(),
});

const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: telegramUserSchema.optional(),
  chat: z.object({
    id: z.number().int(),
    type: z.string().optional(),
  }),
  date: z.number().int(),
  text: z.string().optional(),
  reply_to_message: z
    .object({
      message_id: z.number().int(),
    })
    .optional(),
});

const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: telegramUserSchema,
  message: telegramMessageSchema.optional(),
  data: z.string().optional(),
});

const telegramUpdateSchema = z.object({
  update_id: z.number().int().optional(),
  message: telegramMessageSchema.optional(),
  edited_message: telegramMessageSchema.optional(),
  callback_query: telegramCallbackQuerySchema.optional(),
});

/** Optional simplified payload (tests/tools); requires message_id. */
const simplifiedForwardSchema = z.object({
  text: z.string().min(1),
  user_id: z.coerce.number().int().positive(),
  chat_id: z.coerce.number().int().positive().optional(),
  message_id: z.coerce.number().int().positive(),
  date: z.coerce.number().int().positive().optional(),
  reply_to_message_id: z.coerce.number().int().positive().optional(),
});

export interface ParsedTelegramCapture {
  userId: number;
  chatId: number;
  messageId: number;
  text: string;
  receivedAt: string;
  replyToMessageId?: number;
  updateId?: number;
}

export interface ParsedTelegramCallback {
  userId: number;
  chatId: number;
  messageId: number;
  callbackQueryId: string;
  data: string;
}

export type ParseTelegramUpdateResult =
  | { kind: 'capture'; capture: ParsedTelegramCapture }
  | { kind: 'callback'; callback: ParsedTelegramCallback }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; error: string };

function unixToIso(dateUnix: number): string {
  return new Date(dateUnix * 1000).toISOString();
}

function fromMessage(
  message: z.infer<typeof telegramMessageSchema>,
  updateId?: number,
): ParseTelegramUpdateResult {
  const text = message.text?.trim();
  if (!text) {
    return { kind: 'ignored', reason: 'message_without_text' };
  }
  const userId = message.from?.id ?? message.chat.id;
  if (!isValidTelegramMessageId(message.message_id)) {
    return { kind: 'invalid', error: 'message_id_required' };
  }
  return {
    kind: 'capture',
    capture: {
      userId,
      chatId: message.chat.id,
      messageId: message.message_id,
      text,
      receivedAt: unixToIso(message.date),
      replyToMessageId: message.reply_to_message?.message_id,
      updateId,
    },
  };
}

function fromCallbackQuery(
  query: z.infer<typeof telegramCallbackQuerySchema>,
): ParseTelegramUpdateResult {
  const data = query.data?.trim();
  if (!data) {
    return { kind: 'ignored', reason: 'callback_without_data' };
  }
  const message = query.message;
  if (!message) {
    return { kind: 'ignored', reason: 'callback_without_message' };
  }
  return {
    kind: 'callback',
    callback: {
      userId: query.from.id,
      chatId: message.chat.id,
      messageId: message.message_id,
      callbackQueryId: query.id,
      data,
    },
  };
}

export function parseTelegramWebhookBody(body: unknown): ParseTelegramUpdateResult {
  if (body != null && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if ('message' in record || 'edited_message' in record || 'callback_query' in record) {
      const update = telegramUpdateSchema.safeParse(body);
      if (update.success) {
        if (update.data.callback_query) {
          return fromCallbackQuery(update.data.callback_query);
        }
        const message = update.data.message ?? update.data.edited_message;
        if (!message) {
          return { kind: 'ignored', reason: 'no_message' };
        }
        return fromMessage(message, update.data.update_id);
      }
    }
  }

  const simplified = simplifiedForwardSchema.safeParse(body);
  if (simplified.success) {
    const dateUnix = simplified.data.date ?? Math.floor(Date.now() / 1000);
    return {
      kind: 'capture',
      capture: {
        userId: simplified.data.user_id,
        chatId: simplified.data.chat_id ?? simplified.data.user_id,
        messageId: simplified.data.message_id,
        text: simplified.data.text.trim(),
        receivedAt: unixToIso(dateUnix),
        replyToMessageId: simplified.data.reply_to_message_id,
      },
    };
  }

  return { kind: 'invalid', error: 'unrecognized_payload' };
}
