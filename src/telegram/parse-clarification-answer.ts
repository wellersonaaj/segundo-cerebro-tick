export const NEW_CAPTURE_PREFIX_RE = /^nova:\s*/i;

export function isNewCaptureIntent(text: string): boolean {
  return NEW_CAPTURE_PREFIX_RE.test(text.trim());
}

export function stripNewCapturePrefix(text: string): string {
  return text.trim().replace(NEW_CAPTURE_PREFIX_RE, '').trim();
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
