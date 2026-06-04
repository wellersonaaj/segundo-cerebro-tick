/** Canonical idempotency key for Telegram captures (direct Bot API webhook). */
export function buildTelegramSourceReference(chatId: number, messageId: number): string {
  if (!isValidTelegramMessageId(messageId)) {
    throw new Error('TELEGRAM_MESSAGE_ID_REQUIRED');
  }
  return `telegram:chat:${chatId}:message:${messageId}`;
}

export function isValidTelegramMessageId(messageId: number): boolean {
  return Number.isInteger(messageId) && messageId > 0;
}

/** Legacy keys from n8n/postgres ingest — kept for audit lookups only. */
export function isLegacyTelegramSourceReference(sourceReference: string | null | undefined): boolean {
  if (!sourceReference?.trim()) return false;
  return /^telegram:update:\d+$/i.test(sourceReference.trim());
}
