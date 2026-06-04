import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { EnrichmentTrigger } from '../types/external-knowledge-enrichment.js';
import { normalizeText } from '../utils/normalize.js';
import type { MemoryResolverResult, ResolvedReference } from './reference-resolver.service.js';

/** Relative temporal language in user text — resolve locally, never via web search on entity names. */
export const RELATIVE_TEMPORAL_HINT =
  /\b(semana que vem|pr[oó]xima semana|amanh[aã]|hoje|ontem|m[eê]s que vem|sexta|segunda|ter[cç]a|quarta|quinta|s[aá]bado|domingo|\d{1,2}\/\d{1,2})\b/i;

const EXCERPT_TEMPORAL_LITERAL_PATTERNS: RegExp[] = [
  /\b(hoje|ontem|amanh[aã])(?:\s+(?:a|à|de)\s+noite)?(?:\s*\([^)]+\))?/i,
  /\bsemana que vem\b/i,
  /\bpr[oó]xima semana\b/i,
  /\b(?:pr[oó]xima|esta|essa)\s+(?:segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?\b/i,
  /\((segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?\)/i,
  /\b(sexta|segunda|ter[cç]a|quarta|quinta|s[aá]bado|domingo)(?:-feira)?\b/i,
];

const PRIVATE_REGISTRY_ENTITY_TYPES = new Set(['person', 'company']);

const PERSONAL_EVENT_KINDS = new Set(['meeting', 'conversation']);

export function excerptHasRelativeTemporalHint(text: string): boolean {
  return RELATIVE_TEMPORAL_HINT.test(text);
}

export function extractTemporalLiteralsFromExcerpt(excerpt: string): string[] {
  const found: string[] = [];
  for (const pattern of EXCERPT_TEMPORAL_LITERAL_PATTERNS) {
    const match = excerpt.match(pattern);
    if (match?.[0]?.trim()) found.push(match[0].trim());
  }
  if (/\bhoje\b/i.test(excerpt) && !found.some((f) => /^hoje/i.test(f))) {
    found.push('hoje');
  }
  return [...new Set(found)];
}

export function lookupResolvedReference(
  resolver: MemoryResolverResult,
  reference: string,
): ResolvedReference | undefined {
  return (
    resolver.byReferenceText.get(reference) ??
    resolver.byReferenceText.get(normalizeText(reference))
  );
}

export function entityMentionType(
  reference: string,
  output: ExtractorOutputV14,
): string | null {
  const norm = normalizeText(reference);
  const mention = output.entity_mentions.find((m) => normalizeText(m.mention_text) === norm);
  return mention?.suggested_entity_type ?? null;
}

/** Registry-backed identity — not a public web-discoverable concept. */
export function isRegistryPrivateReference(
  reference: string,
  resolver: MemoryResolverResult,
  output: ExtractorOutputV14,
): boolean {
  const resolved = lookupResolvedReference(resolver, reference);
  if (resolved?.status !== 'resolved' || !resolved.entity_id) return false;

  const mentionType = entityMentionType(reference, output);
  if (mentionType && PRIVATE_REGISTRY_ENTITY_TYPES.has(mentionType)) return true;

  // Resolved in registry without public/topic typing — treat as private knowledge.
  if (mentionType && mentionType !== 'topic' && mentionType !== 'other') return true;

  return resolved.confidence >= 0.9;
}

export function isPersonalMeetingEvent(
  event: ExtractorOutputV14['events'][number],
  output: ExtractorOutputV14,
): boolean {
  if (!PERSONAL_EVENT_KINDS.has(event.event_kind)) return false;
  return event.related_entities.some((rel) => {
    const type = entityMentionType(rel.entity_reference, output);
    return type === 'person';
  });
}

export function isEnrichmentTriggerEligible(
  trigger: EnrichmentTrigger,
  output: ExtractorOutputV14,
  resolver: MemoryResolverResult,
): boolean {
  if (isRegistryPrivateReference(trigger.targetReference, resolver, output)) {
    return false;
  }

  if (trigger.gapKind === 'missing_event_date') {
    if (excerptHasRelativeTemporalHint(trigger.sourceExcerpt)) {
      return false;
    }
  }

  return true;
}

export function filterEnrichmentTriggers(
  triggers: EnrichmentTrigger[],
  output: ExtractorOutputV14,
  resolver: MemoryResolverResult,
): EnrichmentTrigger[] {
  return triggers.filter((t) => isEnrichmentTriggerEligible(t, output, resolver));
}

export function shouldAutoApplyEnrichmentToEvent(event: {
  eventKind: string;
  relatedEntities: Array<{ resolutionStatus: string; entityId: string | null }>;
}): boolean {
  if (!PERSONAL_EVENT_KINDS.has(event.eventKind)) return true;
  return !event.relatedEntities.some(
    (r) => r.resolutionStatus === 'resolved' && r.entityId != null,
  );
}
