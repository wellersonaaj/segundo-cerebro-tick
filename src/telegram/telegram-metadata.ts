import type { ClarificationRequest } from '../types/domain.js';

export interface TelegramClarificationState {
  active_clarification_id: string;
  prompt_message_id: number;
}

export function getTelegramChatId(metadata: Record<string, unknown> | null | undefined): number | null {
  const telegram = metadata?.telegram;
  if (!telegram || typeof telegram !== 'object') return null;
  const chatId = (telegram as { chat_id?: unknown }).chat_id;
  return typeof chatId === 'number' ? chatId : null;
}

export function getTelegramClarificationState(
  metadata: Record<string, unknown> | null | undefined,
): TelegramClarificationState | null {
  const state = metadata?.telegram_clarification;
  if (!state || typeof state !== 'object') return null;
  const s = state as { active_clarification_id?: unknown; prompt_message_id?: unknown };
  if (typeof s.active_clarification_id !== 'string' || typeof s.prompt_message_id !== 'number') {
    return null;
  }
  return {
    active_clarification_id: s.active_clarification_id,
    prompt_message_id: s.prompt_message_id,
  };
}

export function withTelegramClarificationState(
  metadata: Record<string, unknown> | null | undefined,
  state: TelegramClarificationState | null,
): Record<string, unknown> {
  const base = { ...(metadata ?? {}) };
  if (state) {
    base.telegram_clarification = state;
  } else {
    delete base.telegram_clarification;
  }
  return base;
}

export function isTelegramPromptableClarification(c: ClarificationRequest): boolean {
  if (c.status !== 'pending') return false;
  if (c.blocking_scope === 'external_action') return false;
  return true;
}
