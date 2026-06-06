export const NEW_CAPTURE_PREFIX_RE = /^nova:\s*/i;

export function isNewCaptureIntent(text: string): boolean {
  return NEW_CAPTURE_PREFIX_RE.test(text.trim());
}

export function stripNewCapturePrefix(text: string): string {
  return text.trim().replace(NEW_CAPTURE_PREFIX_RE, '').trim();
}

const CLARIFICATION_SHORT_WORD_RE =
  /^(sim|não|nao|yes|no|correto|certinho|isso)$/i;

const CLARIFICATION_ANSWER_PREFIX_RE =
  /^(?:é\s|na verdade é\s|na verdade,\s*é\s)/i;

/**
 * Heuristic for "is this text an answer to a pending clarification?".
 *
 * Accepted shapes (positive signals):
 *  - Short reply (≤ 3 chars): "1", "2", "ok", "sim", etc.
 *  - Exact "sim" / "não" / "correto" / "isso"
 *  - "é X" / "na verdade é X" — explicit confirmation style
 *  - **NEW:** if `suggestedAnswers` provided, the text is a case-insensitive
 *    substring (or equal) of any suggested answer. Catches the case where
 *    the user types the literal text of an option (e.g. the bot offered
 *    "1. Gabriel Xavier" and the user replies "Gabriel Xavier" without the
 *    number). Without this, the answer was treated as a new save.
 */
export function looksLikeClarificationAnswer(
  text: string,
  suggestedAnswers?: readonly string[],
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length <= 3) return true;
  if (/^[12]$/.test(trimmed)) return true;
  if (CLARIFICATION_SHORT_WORD_RE.test(trimmed)) return true;
  if (CLARIFICATION_ANSWER_PREFIX_RE.test(trimmed)) return true;
  if (suggestedAnswers && suggestedAnswers.length > 0) {
    const normalized = trimmed.toLowerCase();
    for (const opt of suggestedAnswers) {
      const optTrim = (opt ?? '').trim();
      if (!optTrim) continue;
      const optLower = optTrim.toLowerCase();
      // Exact match or substring containment (handles "Gabriel Xavier"
      // matching the option "Gabriel Xavier" or even "Xavier" if user
      // typed just the surname).
      if (optLower === normalized) return true;
      if (optLower.includes(normalized) && normalized.length >= 3) return true;
      if (normalized.includes(optLower) && optLower.length >= 3) return true;
    }
  }
  return false;
}

export function parseClarificationAnswer(
  text: string,
  suggestedAnswers: string[],
): string {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index >= 0 && index < suggestedAnswers.length) {
      return suggestedAnswers[index]!;
    }
  }
  return trimmed;
}
