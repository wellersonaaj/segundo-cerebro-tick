import { describe, expect, it } from 'vitest';
import { formatClarificationPrompt } from '../src/telegram/format-clarification-prompt.js';
import {
  isNewCaptureIntent,
  parseClarificationAnswer,
  stripNewCapturePrefix,
} from '../src/telegram/parse-clarification-answer.js';
import { parseTelegramWebhookBody } from '../src/telegram/parse-update.js';
import type { ClarificationRequest } from '../src/types/domain.js';

describe('parse-clarification-answer', () => {
  it('maps numeric answer to suggested option', () => {
    expect(parseClarificationAnswer('2', ['A', 'B', 'C'])).toBe('B');
  });

  it('returns free text when not a valid index', () => {
    expect(parseClarificationAnswer('ESX é a feira E3', [])).toBe('ESX é a feira E3');
  });

  it('detects nova: prefix for forced capture', () => {
    expect(isNewCaptureIntent('nova: outra mensagem')).toBe(true);
    expect(stripNewCapturePrefix('nova: outra mensagem')).toBe('outra mensagem');
    expect(isNewCaptureIntent('1')).toBe(false);
  });
});

describe('format-clarification-prompt', () => {
  it('formats numbered options', () => {
    const clarification = {
      target_reference: 'ESX',
      question: 'O que é ESX?',
      suggested_answers: ['Opção A', 'Opção B'],
    } as ClarificationRequest;
    const text = formatClarificationPrompt(clarification);
    expect(text).toContain('Confirmação (ESX)');
    expect(text).toContain('1. Opção A');
    expect(text).toContain('nova:');
  });
});

describe('parseTelegramWebhookBody reply_to', () => {
  it('parses native telegram reply_to_message', () => {
    const parsed = parseTelegramWebhookBody({
      message: {
        message_id: 99,
        chat: { id: 5991664193 },
        from: { id: 5991664193 },
        date: 1_700_000_000,
        text: '1',
        reply_to_message: { message_id: 55 },
      },
    });
    expect(parsed.kind).toBe('capture');
    if (parsed.kind === 'capture') {
      expect(parsed.capture.replyToMessageId).toBe(55);
    }
  });

  it('parses simplified forward with reply_to_message_id', () => {
    const parsed = parseTelegramWebhookBody({
      text: '2',
      user_id: 5991664193,
      chat_id: 5991664193,
      message_id: 78,
      reply_to_message_id: 77,
    });
    expect(parsed.kind).toBe('capture');
    if (parsed.kind === 'capture') {
      expect(parsed.capture.replyToMessageId).toBe(77);
      expect(parsed.capture.chatId).toBe(5991664193);
    }
  });
});
