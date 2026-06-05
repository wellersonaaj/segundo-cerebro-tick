import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getTelegramConfig } from '../config/telegram.js';
import { parseTelegramWebhookBody } from '../telegram/parse-update.js';
import {
  answerTelegramCallbackQuery,
  editTelegramMessageText,
} from '../telegram/telegram-bot.client.js';
import { sendTelegramMessageSafe } from '../services/assistant-delivery.js';
import type { CommandHandlerService } from '../services/command-handler.service.js';
import type { TelegramInboxService } from '../services/telegram-inbox.service.js';
import { log } from '../utils/logger.js';
import { logError, logWebhookReceived } from '../utils/structured-logger.js';
import { getCurrentTurn, runWithTurn } from '../utils/turn-context.js';

const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function readWebhookSecret(req: FastifyRequest): string | undefined {
  const header = req.headers[TELEGRAM_SECRET_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const alt = req.headers['x-webhook-secret'];
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  const query = (req.query as { secret?: string }).secret;
  if (typeof query === 'string' && query.trim()) return query.trim();
  return undefined;
}

function isSecretValid(req: FastifyRequest, expected: string): boolean {
  const received = readWebhookSecret(req);
  return received != null && received === expected;
}

export interface TelegramWebhookRouteDeps {
  telegramInbox: TelegramInboxService;
  commandHandler: CommandHandlerService;
}

export async function registerTelegramWebhookRoutes(
  app: FastifyInstance,
  deps: TelegramWebhookRouteDeps,
): Promise<void> {
  app.post('/webhooks/telegram', async (req, reply) => {
    const config = getTelegramConfig();
    if (!config) {
      return reply.status(503).send({ error: 'TELEGRAM_NOT_CONFIGURED' });
    }

    if (!isSecretValid(req, config.webhookSecret)) {
      return reply.status(401).send({ error: 'Invalid webhook secret' });
    }

    const parsed = parseTelegramWebhookBody(req.body);
    if (parsed.kind === 'invalid') {
      return reply.status(400).send({ error: parsed.error });
    }
    if (parsed.kind === 'ignored') {
      return reply.send({ ok: true, ignored: true, reason: parsed.reason });
    }

    if (parsed.kind === 'callback') {
      const { callback } = parsed;
      if (callback.userId !== config.allowedUserId) {
        return reply.status(403).send({ error: 'User not allowed' });
      }

      reply.send({ ok: true, accepted: true, kind: 'callback' });

      void (async () => {
        try {
          await answerTelegramCallbackQuery(config, callback.callbackQueryId);
          if (!callback.data.startsWith('status:')) return;
          const response = await deps.commandHandler.handleStatusCallback(callback.data);
          await editTelegramMessageText(
            config,
            callback.chatId,
            callback.messageId,
            response.text,
            {
              parse_mode: response.parse_mode,
              reply_markup: response.reply_markup,
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('error', 'telegram_webhook', {
            step: 'callback_failed',
            error: message,
            callback_data: callback.data,
          });
        }
      })();
      return;
    }

    const { capture } = parsed;
    if (capture.userId !== config.allowedUserId) {
      log('warn', 'telegram_webhook', {
        step: 'user_rejected',
        user_id: capture.userId,
        allowed: config.allowedUserId,
      });
      return reply.status(403).send({ error: 'User not allowed' });
    }

    const turn_id = randomUUID();
    await logWebhookReceived({
      turn_id,
      user_id: capture.userId,
      chat_id: capture.chatId,
      message_id: capture.messageId,
      text_preview: capture.text,
    });

    reply.send({ ok: true, accepted: true });

    void runWithTurn(
      {
        turn_id,
        user_id: capture.userId,
        chat_id: capture.chatId,
        message_id: capture.messageId,
      },
      async () => {
        const turn = getCurrentTurn();
        try {
          const handled = await deps.telegramInbox.handleIncoming(capture);
          log('info', 'telegram_webhook', {
            step: 'capture_handled',
            kind: handled.kind,
            turn_id: handled.turn_id,
            chat_id: capture.chatId,
            message_id: capture.messageId,
          });
          await turn?.handle.finish({ output: { kind: handled.kind } });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await logError({ turn_id, stage: 'webhook_handler', error: err });
          await turn?.handle.finish({ error: message });
          log('error', 'telegram_webhook', {
            step: 'capture_failed',
            error: message,
            chat_id: capture.chatId,
            message_id: capture.messageId,
          });
          await sendTelegramMessageSafe(
            config,
            capture.chatId,
            'Não consegui processar esta mensagem. Tente de novo em instantes.',
            { step: 'error_reply' },
          );
        }
      },
    );
  });
}
