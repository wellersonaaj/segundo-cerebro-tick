import { loadEnv } from './env.js';

export interface TelegramConfig {
  botToken: string;
  allowedUserId: number;
  webhookSecret: string;
  webhookUrl: string;
  defaultTimezone: string;
  senderEntityReference: string | null;
}

export function isTelegramConfigured(): boolean {
  return getTelegramConfig() != null;
}

export function getTelegramConfig(): TelegramConfig | null {
  const env = loadEnv();
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL } =
    env;
  if (
    !TELEGRAM_BOT_TOKEN?.trim() ||
    TELEGRAM_ALLOWED_USER_ID == null ||
    !TELEGRAM_WEBHOOK_SECRET?.trim() ||
    !TELEGRAM_WEBHOOK_URL?.trim()
  ) {
    return null;
  }
  return {
    botToken: TELEGRAM_BOT_TOKEN,
    allowedUserId: TELEGRAM_ALLOWED_USER_ID,
    webhookSecret: TELEGRAM_WEBHOOK_SECRET,
    webhookUrl: TELEGRAM_WEBHOOK_URL,
    defaultTimezone: env.TELEGRAM_DEFAULT_TIMEZONE,
    senderEntityReference: env.TELEGRAM_SENDER_ENTITY_REFERENCE?.trim() ?? null,
  };
}

export function requireTelegramConfig(): TelegramConfig {
  const config = getTelegramConfig();
  if (!config) {
    throw new Error('TELEGRAM_NOT_CONFIGURED');
  }
  return config;
}
