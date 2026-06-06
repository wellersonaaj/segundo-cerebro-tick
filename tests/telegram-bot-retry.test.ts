import { describe, expect, it, vi } from 'vitest';
import {
  sendTelegramMessage,
  TelegramApiError,
  type TelegramConfig,
} from '../src/telegram/telegram-bot.client.js';

const config: TelegramConfig = {
  botToken: 'TEST',
  webhookUrl: 'https://example.com/webhook',
  webhookSecret: 'secret',
  defaultChatId: 123,
  allowedUserId: 1,
  parseMode: 'Markdown',
};

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error(`mock fetch out of responses at call ${i}`);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response;
  });
}

describe('telegram-bot retry/classification', () => {
  it('retries 5xx errors and eventually succeeds', async () => {
    const fetchFn = mockFetch([
      { status: 500, body: { ok: false, description: 'internal' } },
      { status: 200, body: { ok: true, result: { message_id: 1 } } },
    ]);
    await sendTelegramMessage(config, 42, 'hi', undefined, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry 4xx errors (404 chat not found) and surfaces them', async () => {
    const fetchFn = mockFetch([
      { status: 404, body: { ok: false, description: 'Not Found' } },
    ]);
    await expect(
      sendTelegramMessage(config, 999, 'hi', undefined, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(TelegramApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry 403 (bot blocked) and surfaces the error', async () => {
    const fetchFn = mockFetch([
      {
        status: 403,
        body: { ok: false, description: 'Forbidden: bot was blocked by the user' },
      },
    ]);
    await expect(
      sendTelegramMessage(config, 999, 'hi', undefined, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/Forbidden/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries 429 rate limit', async () => {
    const fetchFn = mockFetch([
      { status: 429, body: { ok: false, description: 'Too Many Requests' } },
      { status: 200, body: { ok: true, result: { message_id: 2 } } },
    ]);
    await sendTelegramMessage(config, 42, 'hi', undefined, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries network errors (fetch threw)', async () => {
    let i = 0;
    const fetchFn = vi.fn(async () => {
      i += 1;
      if (i < 3) throw new Error('ECONNRESET');
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 3 } }),
      } as Response;
    });
    await sendTelegramMessage(
      config,
      42,
      'hi',
      undefined,
      fetchFn as unknown as typeof fetch,
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const fetchFn = mockFetch([
      { status: 500, body: { ok: false, description: 'a' } },
      { status: 500, body: { ok: false, description: 'b' } },
      { status: 500, body: { ok: false, description: 'c' } },
    ]);
    await expect(
      sendTelegramMessage(config, 42, 'hi', undefined, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(TelegramApiError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
