import type { SourceMode } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import type { MemoryResolverResult, ResolvedReference } from './reference-resolver.service.js';

const FIRST_PERSON_PRONOUNS = new Set(['eu', 'mim', 'me'].map(normalizeText));

export function isFirstPersonPronoun(referenceText: string): boolean {
  return FIRST_PERSON_PRONOUNS.has(normalizeText(referenceText));
}

/**
 * When conversational mode and sender is trusted-resolved, map first-person pronouns to sender entity.
 */
export function applyFirstPersonPronounToResolverResult(
  result: MemoryResolverResult,
  sourceMode: SourceMode,
  senderResolved: ResolvedReference | null,
): MemoryResolverResult {
  if (sourceMode !== 'conversational' || !senderResolved?.entity_id) {
    return result;
  }

  const byReferenceText = new Map(result.byReferenceText);
  const references = [...result.references];

  for (const pronoun of FIRST_PERSON_PRONOUNS) {
    const mapped: ResolvedReference = {
      reference_text: pronoun,
      status: 'resolved',
      entity_id: senderResolved.entity_id,
      canonical_name: senderResolved.canonical_name,
      candidates: senderResolved.candidates,
      confidence: Math.max(senderResolved.confidence, 0.85),
    };
    byReferenceText.set(pronoun, mapped);
    if (!references.some((r) => normalizeText(r.reference_text) === pronoun)) {
      references.push(mapped);
    } else {
      const idx = references.findIndex((r) => normalizeText(r.reference_text) === pronoun);
      if (idx >= 0) references[idx] = mapped;
    }
  }

  return { references, byReferenceText };
}
