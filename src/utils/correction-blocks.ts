const CORRECTION_MARKER = /^\[CORREÇÃO\]\s*/i;

export interface ParsedEffectiveContent {
  rawContent: string;
  corrections: string[];
  effectiveContent: string;
}

/** Split raw inbox text and appended `[CORREÇÃO]` blocks (same convention as EffectiveInputBuilder). */
export function parseCorrectionBlocks(content: string): ParsedEffectiveContent {
  const parts = content.split(/\n\n+/);
  const rawParts: string[] = [];
  const corrections: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (CORRECTION_MARKER.test(trimmed)) {
      corrections.push(trimmed.replace(CORRECTION_MARKER, '').trim());
    } else {
      rawParts.push(trimmed);
    }
  }

  const rawContent = rawParts.join('\n\n');
  const effectiveContent =
    corrections.length === 0
      ? rawContent
      : [rawContent, ...corrections.map((c) => `[CORREÇÃO] ${c}`)].join('\n\n');

  return { rawContent, corrections, effectiveContent };
}
