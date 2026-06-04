import type { SourceMode } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import type { MemoryResolverResult, ResolvedReference } from './reference-resolver.service.js';
import type { ThreadConversationContext } from './thread-conversation-context.service.js';
import { resolveThreadSalientPerson } from './thread-conversation-context.service.js';

const OBJECT_PRONOUNS = ['ela', 'dela', 'ele', 'dele'] as const;

export function isThirdPersonObjectPronoun(referenceText: string): boolean {
  return OBJECT_PRONOUNS.includes(normalizeText(referenceText.trim()) as (typeof OBJECT_PRONOUNS)[number]);
}

export function applyThreadPronounCoreference(
  result: MemoryResolverResult,
  sourceMode: SourceMode,
  threadContext: ThreadConversationContext | null,
): MemoryResolverResult {
  if (sourceMode !== 'conversational' || !threadContext) return result;

  const salientPerson = resolveThreadSalientPerson(threadContext);
  if (!salientPerson) return result;

  const registryHit =
    result.byReferenceText.get(salientPerson.reference) ??
    result.byReferenceText.get(normalizeText(salientPerson.reference));

  const mapped: ResolvedReference = {
    reference_text: salientPerson.reference,
    status: registryHit?.status === 'resolved' ? 'resolved' : registryHit?.status ?? 'resolved',
    entity_id: registryHit?.entity_id ?? null,
    canonical_name: registryHit?.canonical_name ?? salientPerson.canonicalName ?? salientPerson.reference,
    candidates: registryHit?.candidates ?? [],
    confidence: registryHit?.confidence ?? 0.85,
  };

  const byReferenceText = new Map(result.byReferenceText);
  const references = [...result.references];

  for (const pronoun of OBJECT_PRONOUNS) {
    byReferenceText.set(pronoun, { ...mapped, reference_text: pronoun });
    const idx = references.findIndex((r) => normalizeText(r.reference_text) === pronoun);
    if (idx >= 0) {
      references[idx] = { ...mapped, reference_text: pronoun };
    } else {
      references.push({ ...mapped, reference_text: pronoun });
    }
  }

  return { references, byReferenceText };
}

export function collectResolvedThreadPronouns(
  result: MemoryResolverResult,
): Set<string> {
  const resolved = new Set<string>();
  for (const pronoun of OBJECT_PRONOUNS) {
    const hit =
      result.byReferenceText.get(pronoun) ?? result.byReferenceText.get(normalizeText(pronoun));
    if (hit?.status === 'resolved' && hit.entity_id) {
      resolved.add(pronoun);
    }
  }
  return resolved;
}
