import { z } from 'zod';

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
});

const telegramUpdateSchema = z.object({
  update_id: z.number().int().optional(),
  message: telegramMessageSchema.optional(),
  edited_message: telegramMessageSchema.optional(),
});

/** Payload simplificado que o n8n pode encaminhar após o trigger do Telegram. */
const n8nForwardSchema = z.object({
  text: z.string().min(1),
  user_id: z.coerce.number().int().positive(),
  message_id: z.coerce.number().int().positive().optional(),
  date: z.coerce.number().int().positive().optional(),
});

export interface ParsedTelegramCapture {
  userId: number;
  chatId: number;
  messageId: number;
  text: string;
  receivedAt: string;
}

export type ParseTelegramUpdateResult =
  | { kind: 'capture'; capture: ParsedTelegramCapture }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; error: string };

function unixToIso(dateUnix: number): string {
  return new Date(dateUnix * 1000).toISOString();
}

function fromMessage(message: z.infer<typeof telegramMessageSchema>): ParseTelegramUpdateResult {
  const text = message.text?.trim();
  if (!text) {
    return { kind: 'ignored', reason: 'message_without_text' };
  }
  const userId = message.from?.id ?? message.chat.id;
  return {
    kind: 'capture',
    capture: {
      userId,
      chatId: message.chat.id,
      messageId: message.message_id,
      text,
      receivedAt: unixToIso(message.date),
    },
  };
}

export function parseTelegramWebhookBody(body: unknown): ParseTelegramUpdateResult {
  const n8n = n8nForwardSchema.safeParse(body);
  if (n8n.success) {
    const dateUnix = n8n.data.date ?? Math.floor(Date.now() / 1000);
    return {
      kind: 'capture',
      capture: {
        userId: n8n.data.user_id,
        chatId: n8n.data.user_id,
        messageId: n8n.data.message_id ?? 0,
        text: n8n.data.text.trim(),
        receivedAt: unixToIso(dateUnix),
      },
    };
  }

  const update = telegramUpdateSchema.safeParse(body);
  if (!update.success) {
    return { kind: 'invalid', error: 'unrecognized_payload' };
  }

  const message = update.data.message ?? update.data.edited_message;
  if (!message) {
    return { kind: 'ignored', reason: 'no_message' };
  }

  return fromMessage(message);
}
