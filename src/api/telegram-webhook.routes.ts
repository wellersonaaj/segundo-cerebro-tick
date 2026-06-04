import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getTelegramConfig } from '../config/telegram.js';
import { parseTelegramWebhookBody } from '../telegram/parse-update.js';
import { sendTelegramMessage } from '../telegram/telegram-bot.client.js';
import type { TelegramInboxService } from '../services/telegram-inbox.service.js';
import { log } from '../utils/logger.js';

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

    const { capture } = parsed;
    if (capture.userId !== config.allowedUserId) {
      log('warn', 'telegram_webhook', {
        step: 'user_rejected',
        user_id: capture.userId,
        allowed: config.allowedUserId,
      });
      return reply.status(403).send({ error: 'User not allowed' });
    }

    log('info', 'telegram_webhook', {
      step: 'capture_start',
      chat_id: capture.chatId,
      message_id: capture.messageId,
    });

    try {
      const result = await deps.telegramInbox.ingestAndNotify(capture);
      return reply.status(201).send({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'telegram_webhook', { step: 'capture_failed', error: message });
      try {
        await sendTelegramMessage(
          config,
          capture.chatId,
          'Não consegui processar esta mensagem. Tente de novo em instantes.',
        );
      } catch {
        // ignore
      }
      return reply.status(500).send({ error: message });
    }
  });
}
