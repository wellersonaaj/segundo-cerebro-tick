import { describe, expect, it } from 'vitest';
import { parseTelegramWebhookBody } from '../src/telegram/parse-update.js';

describe('parseTelegramWebhookBody', () => {
  it('parses Telegram Update message', () => {
    const result = parseTelegramWebhookBody({
      update_id: 9,
      message: {
        message_id: 3,
        from: { id: 5991664193 },
        chat: { id: 5991664193 },
        date: 1_700_000_000,
        text: '  Lembrete de reunião  ',
      },
    });
    expect(result.kind).toBe('capture');
    if (result.kind !== 'capture') return;
    expect(result.capture.text).toBe('Lembrete de reunião');
    expect(result.capture.userId).toBe(5991664193);
    expect(result.capture.receivedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('parses simplified forward payload with message_id', () => {
    const result = parseTelegramWebhookBody({
      text: 'Tarefa para o Nico',
      user_id: 5991664193,
      message_id: 12,
      date: 1_700_000_100,
    });
    expect(result.kind).toBe('capture');
    if (result.kind !== 'capture') return;
    expect(result.capture.text).toBe('Tarefa para o Nico');
    expect(result.capture.messageId).toBe(12);
  });

  it('rejects simplified payload without message_id', () => {
    const result = parseTelegramWebhookBody({
      text: 'Tarefa para o Nico',
      user_id: 5991664193,
      date: 1_700_000_100,
    });
    expect(result).toEqual({ kind: 'invalid', error: 'unrecognized_payload' });
  });

  it('ignores updates without text', () => {
    const result = parseTelegramWebhookBody({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1 },
        date: 1,
      },
    });
    expect(result).toEqual({ kind: 'ignored', reason: 'message_without_text' });
  });
});
