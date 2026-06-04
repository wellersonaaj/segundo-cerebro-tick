const PERIPHERAL_PREFIX = 'peripheral_ambiguity_ignored:';
const GENERIC_DROP_PREFIX = 'generic_entity_term_dropped:';
const WEAK_TOPIC_PREFIX = 'weak_topic preserved in notes:';

function extractPrefixedTerm(note: string, prefix: string): string | null {
  if (!note.startsWith(prefix)) return null;
  const term = note.slice(prefix.length).trim();
  if (!term || term.length > 120) return null;
  if (/[\n\r]/.test(term)) return null;
  return term;
}

function extractFromNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (!trimmed) return null;

  return (
    extractPrefixedTerm(trimmed, PERIPHERAL_PREFIX) ??
    extractPrefixedTerm(trimmed, GENERIC_DROP_PREFIX) ??
    extractPrefixedTerm(trimmed, WEAK_TOPIC_PREFIX)
  );
}

/** Defensive extraction — returns terms only from known note prefixes; otherwise empty. */
export function extractPeripheralTerms(
  processingNotes: unknown,
  compilerNotes: unknown,
): string[] {
  const notes: unknown[] = [];
  if (Array.isArray(processingNotes)) notes.push(...processingNotes);
  if (Array.isArray(compilerNotes)) notes.push(...compilerNotes);

  const terms = new Set<string>();
  for (const note of notes) {
    const term = extractFromNote(note);
    if (term) terms.add(term);
  }
  return [...terms];
}
