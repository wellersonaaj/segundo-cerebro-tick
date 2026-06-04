import { describe, expect, it } from 'vitest';
import {
  buildTelegramSourceReference,
  isLegacyTelegramSourceReference,
  isValidTelegramMessageId,
} from '../src/telegram/telegram-source-reference.js';

describe('telegram-source-reference', () => {
  it('builds canonical source reference', () => {
    expect(buildTelegramSourceReference(5991664193, 26)).toBe(
      'telegram:chat:5991664193:message:26',
    );
  });

  it('rejects invalid message_id', () => {
    expect(() => buildTelegramSourceReference(1, 0)).toThrow('TELEGRAM_MESSAGE_ID_REQUIRED');
    expect(isValidTelegramMessageId(0)).toBe(false);
  });

  it('detects legacy n8n references', () => {
    expect(isLegacyTelegramSourceReference('telegram:update:422490938')).toBe(true);
    expect(isLegacyTelegramSourceReference('telegram:chat:1:message:2')).toBe(false);
  });
});
