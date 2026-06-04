/* global fetch */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetEnvCache } from '../src/config/env.js';
import { createScenarioExtractor } from './helpers/mock-extractor.js';

const TELEGRAM_ENV = {
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_ALLOWED_USER_ID: '5991664193',
  TELEGRAM_WEBHOOK_SECRET: 'segredo_gerado',
  TELEGRAM_WEBHOOK_URL: 'https://example.com/webhook/telegram-cerebro-tick',
  SUPABASE_URL: process.env.SUPABASE_URL ?? 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-key-min-1-chars-long',
};

function telegramUpdate(text: string, userId = 5991664193) {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      from: { id: userId, is_bot: false, first_name: 'Test' },
      chat: { id: userId, type: 'private' },
      date: 1_700_000_000,
      text,
    },
  };
}

describe('Telegram webhook', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    resetEnvCache();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 503 when Telegram env is not configured', async () => {
    resetEnvCache();
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'any' },
      payload: telegramUpdate('oi'),
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('rejects invalid secret', async () => {
    resetEnvCache();
    process.env.TELEGRAM_BOT_TOKEN = TELEGRAM_ENV.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_ALLOWED_USER_ID = TELEGRAM_ENV.TELEGRAM_ALLOWED_USER_ID;
    process.env.TELEGRAM_WEBHOOK_SECRET = TELEGRAM_ENV.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_URL = TELEGRAM_ENV.TELEGRAM_WEBHOOK_URL;

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;

    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      payload: telegramUpdate('oi'),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects disallowed user', async () => {
    resetEnvCache();
    Object.assign(process.env, TELEGRAM_ENV);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;

    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_ENV.TELEGRAM_WEBHOOK_SECRET },
      payload: telegramUpdate('oi', 111),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
