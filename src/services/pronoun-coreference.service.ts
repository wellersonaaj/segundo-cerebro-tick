import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { SourceMode } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import type { MemoryResolverResult, ResolvedReference } from './reference-resolver.service.js';
import type { ThreadConversationContext } from './thread-conversation-context.service.js';
import { resolveThreadSalientPerson } from './thread-conversation-context.service.js';

const OBJECT_PRONOUNS = ['ela', 'dela', 'ele', 'dele'] as const;

const FIRST_PERSON = new Set(['eu', 'mim', 'me']);

const MASCULINE_PRONOUNS = new Set(['ele', 'dele']);
const FEMININE_PRONOUNS = new Set(['ela', 'dela']);

export function isThirdPersonObjectPronoun(referenceText: string): boolean {
  return OBJECT_PRONOUNS.includes(normalizeText(referenceText.trim()) as (typeof OBJECT_PRONOUNS)[number]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indexOfWord(text: string, word: string): number {
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'iu');
  const match = re.exec(text);
  return match ? match.index : -1;
}

function pronounGender(pronoun: string): 'masc' | 'fem' | null {
  const n = normalizeText(pronoun);
  if (MASCULINE_PRONOUNS.has(n)) return 'masc';
  if (FEMININE_PRONOUNS.has(n)) return 'fem';
  return null;
}

/** Heurística leve: nomes terminados em "a" tendem ao feminino em PT (ex.: Larisse, Maria). */
function guessPersonGender(reference: string): 'masc' | 'fem' | 'unknown' {
  const t = reference.trim();
  if (!t || FIRST_PERSON.has(normalizeText(t))) return 'unknown';
  if (/[oa]$/i.test(t.split(/\s+/).pop() ?? '')) {
    const last = (t.split(/\s+/).pop() ?? '').toLowerCase();
    if (last.endsWith('a') && !last.endsWith('ia') && last.length > 2) return 'fem';
    if (last.endsWith('o')) return 'masc';
  }
  return 'unknown';
}

function genderCompatible(pronoun: string, antecedent: string): boolean {
  const p = pronounGender(pronoun);
  if (!p) return true;
  const g = guessPersonGender(antecedent);
  if (g === 'unknown') return true;
  return p === g;
}

function collectPersonMentionsInExcerpt(
  output: ExtractorOutputV14,
  excerpt: string,
): Array<{ reference: string; index: number }> {
  const found: Array<{ reference: string; index: number }> = [];
  const seen = new Set<string>();

  const add = (ref: string): void => {
    const trimmed = ref.trim();
    if (!trimmed || FIRST_PERSON.has(normalizeText(trimmed))) return;
    const key = normalizeText(trimmed);
    if (seen.has(key)) return;
    const idx = indexOfWord(excerpt, trimmed);
    if (idx < 0) return;
    seen.add(key);
    found.push({ reference: trimmed, index: idx });
  };

  for (const m of output.entity_mentions ?? []) {
    if (m.suggested_entity_type !== 'person') continue;
    add(m.mention_text);
  }

  for (const ev of output.events ?? []) {
    for (const rel of ev.related_entities ?? []) {
      add(rel.entity_reference);
    }
  }

  for (const a of output.assertions ?? []) {
    if (a.subject_reference?.trim()) add(a.subject_reference);
  }

  return found.sort((a, b) => a.index - b.index);
}

function scoreAntecedentBeforePronoun(
  excerpt: string,
  reference: string,
  pronounIdx: number,
): number {
  const refIdx = indexOfWord(excerpt, reference);
  if (refIdx < 0 || refIdx >= pronounIdx) return -1;

  const before = excerpt.slice(0, pronounIdx);
  const refEsc = escapeRegExp(reference);
  let score = 1;

  if (new RegExp(`\\bmensagem\\s+para\\s+(?:o\\s+|a\\s+)?${refEsc}\\b`, 'iu').test(before)) {
    score += 20;
  }
  if (new RegExp(`\\b(?:para|com|ao|à)\\s+(?:o\\s+|a\\s+)?${refEsc}\\b`, 'iu').test(before)) {
    score += 12;
  }
  if (new RegExp(`\\b${refEsc}\\s+vai\\b`, 'iu').test(excerpt)) {
    score += 8;
  }

  // Preferência leve por menção mais próxima do pronome (desempate).
  score += (pronounIdx - refIdx) / Math.max(excerpt.length, 1);
  return score;
}

/**
 * Antecedente no mesmo trecho: pessoa mais saliente antes do pronome (ex.: "mensagem para o Breno … com ele").
 */
export function resolveInTextPronounAntecedent(
  excerpt: string,
  pronoun: string,
  output: ExtractorOutputV14,
): string | null {
  const pronounIdx = indexOfWord(excerpt, pronoun);
  if (pronounIdx < 0) return null;

  const mentions = collectPersonMentionsInExcerpt(output, excerpt);
  let best: { reference: string; score: number } | null = null;

  for (const m of mentions) {
    if (m.index >= pronounIdx || !genderCompatible(pronoun, m.reference)) continue;
    const score = scoreAntecedentBeforePronoun(excerpt, m.reference, pronounIdx);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { reference: m.reference, score };
    }
  }

  return best?.reference ?? null;
}

function mapPronounToReference(
  result: MemoryResolverResult,
  pronoun: string,
  antecedentRef: string,
): MemoryResolverResult {
  const antecedent =
    result.byReferenceText.get(antecedentRef) ??
    result.byReferenceText.get(normalizeText(antecedentRef));
  if (!antecedent || antecedent.status !== 'resolved' || !antecedent.entity_id) {
    return result;
  }

  const mapped: ResolvedReference = {
    reference_text: pronoun,
    status: 'resolved',
    entity_id: antecedent.entity_id,
    canonical_name: antecedent.canonical_name,
    candidates: antecedent.candidates,
    confidence: Math.min(antecedent.confidence, 0.9),
  };

  const byReferenceText = new Map(result.byReferenceText);
  const references = [...result.references];

  byReferenceText.set(pronoun, mapped);
  byReferenceText.set(normalizeText(pronoun), mapped);
  const idx = references.findIndex((r) => normalizeText(r.reference_text) === normalizeText(pronoun));
  if (idx >= 0) {
    references[idx] = mapped;
  } else {
    references.push(mapped);
  }

  return { references, byReferenceText };
}

function collectExcerptsForPronounResolution(output: ExtractorOutputV14): string[] {
  const excerpts = new Set<string>();
  const add = (t: string | null | undefined): void => {
    const s = t?.trim();
    if (s) excerpts.add(s);
  };

  for (const m of output.entity_mentions ?? []) add(m.source_excerpt);
  for (const c of output.clarification_candidates ?? []) add(c.source_excerpt);
  for (const h of output.review_hints ?? []) add(h.source_excerpt);
  for (const a of output.assertions ?? []) add(a.source_excerpt);
  for (const ev of output.events ?? []) add(ev.source_excerpt);
  for (const t of output.task_signals ?? []) add(t.source_excerpt);

  return [...excerpts];
}

/** Resolve pronomes a partir do texto da própria captura (prioridade sobre thread antiga). */
export function applyInTextPronounCoreference(
  result: MemoryResolverResult,
  output: ExtractorOutputV14,
): MemoryResolverResult {
  const excerpts = collectExcerptsForPronounResolution(output);
  let current = result;

  for (const pronoun of OBJECT_PRONOUNS) {
    const existing =
      current.byReferenceText.get(pronoun) ?? current.byReferenceText.get(normalizeText(pronoun));
    if (existing?.status === 'resolved' && existing.entity_id) continue;

    for (const excerpt of excerpts) {
      if (indexOfWord(excerpt, pronoun) < 0) continue;
      const antecedent = resolveInTextPronounAntecedent(excerpt, pronoun, output);
      if (!antecedent) continue;
      current = mapPronounToReference(current, pronoun, antecedent);
      break;
    }
  }

  return current;
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
    const existing =
      byReferenceText.get(pronoun) ?? byReferenceText.get(normalizeText(pronoun));
    if (existing?.status === 'resolved' && existing.entity_id) continue;

    byReferenceText.set(pronoun, { ...mapped, reference_text: pronoun });
    byReferenceText.set(normalizeText(pronoun), { ...mapped, reference_text: pronoun });
    const idx = references.findIndex((r) => normalizeText(r.reference_text) === pronoun);
    if (idx >= 0) {
      references[idx] = { ...mapped, reference_text: pronoun };
    } else {
      references.push({ ...mapped, reference_text: pronoun });
    }
  }

  return { references, byReferenceText };
}

export function collectResolvedObjectPronouns(result: MemoryResolverResult): Set<string> {
  const resolved = new Set<string>();
  for (const pronoun of OBJECT_PRONOUNS) {
    const hit =
      result.byReferenceText.get(pronoun) ?? result.byReferenceText.get(normalizeText(pronoun));
    if (hit?.status === 'resolved' && hit.entity_id) {
      resolved.add(normalizeText(pronoun));
    }
  }
  return resolved;
}

/** @deprecated Use collectResolvedObjectPronouns */
export function collectResolvedThreadPronouns(result: MemoryResolverResult): Set<string> {
  return collectResolvedObjectPronouns(result);
}
