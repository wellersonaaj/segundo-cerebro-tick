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

export function looksLikeClarificationAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length <= 3) return true;
  if (/^[12]$/.test(trimmed)) return true;
  if (CLARIFICATION_SHORT_WORD_RE.test(trimmed)) return true;
  if (CLARIFICATION_ANSWER_PREFIX_RE.test(trimmed)) return true;
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
