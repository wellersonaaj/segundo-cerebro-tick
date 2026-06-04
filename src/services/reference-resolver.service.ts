import type { EntityLikeSourceMetadata } from '../types/ingestion-context.js';
import { normalizeText } from '../utils/normalize.js';

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';

export interface ResolutionCandidate {
  entity_id: string;
  canonical_name: string;
  match_type: 'exact_name' | 'exact_alias' | 'partial';
}

export interface ResolvedReference {
  reference_text: string;
  status: ResolutionStatus;
  entity_id: string | null;
  canonical_name: string | null;
  candidates: ResolutionCandidate[];
  confidence: number;
}

export interface MemoryResolverResult {
  references: ResolvedReference[];
  byReferenceText: Map<string, ResolvedReference>;
}

export interface RegistryEntityFixture {
  id: string;
  name: string;
  normalized_name: string;
  entity_type: string;
  aliases: string[];
}

const GENERIC_TERMS = new Set(
  ['fornecedor', 'cliente', 'prazo', 'ip', 'responsavel', 'responsável'].map(normalizeText),
);

function tokenMatch(reference: string, candidate: string): boolean {
  const r = normalizeText(reference);
  const c = normalizeText(candidate);
  if (r === c) return true;
  if (r.split(/\s+/).some((t) => t === c)) return true;
  if (c.length >= 5 && r.includes(c)) return true;
  if (r.length >= 5 && c.includes(r)) return true;
  return false;
}

export class ReferenceResolverService {
  constructor(private readonly entities: RegistryEntityFixture[]) {}

  resolveReferences(
    referenceTexts: Iterable<string>,
    trustedReferences?: Map<string, ResolvedReference>,
  ): MemoryResolverResult {
    const unique = [...new Set([...referenceTexts].map((t) => t.trim()).filter(Boolean))];
    const references: ResolvedReference[] = [];
    const byReferenceText = new Map<string, ResolvedReference>();

    if (trustedReferences) {
      for (const [k, v] of trustedReferences) {
        byReferenceText.set(k, v);
        byReferenceText.set(normalizeText(k), v);
      }
    }

    for (const text of unique) {
      const existing =
        byReferenceText.get(text) ?? byReferenceText.get(normalizeText(text));
      if (existing) {
        references.push(existing);
        continue;
      }
      const resolved = this.resolveOne(text);
      references.push(resolved);
      byReferenceText.set(text, resolved);
      byReferenceText.set(normalizeText(text), resolved);
    }

    return { references, byReferenceText };
  }

  resolveOne(referenceText: string): ResolvedReference {
    const norm = normalizeText(referenceText);
    if (GENERIC_TERMS.has(norm)) {
      return {
        reference_text: referenceText,
        status: 'unresolved',
        entity_id: null,
        canonical_name: null,
        candidates: [],
        confidence: 0,
      };
    }

    const candidates: ResolutionCandidate[] = [];

    for (const e of this.entities) {
      if (tokenMatch(referenceText, e.name)) {
        candidates.push({
          entity_id: e.id,
          canonical_name: e.name,
          match_type: 'exact_name',
        });
      }
      for (const alias of e.aliases) {
        if (tokenMatch(referenceText, alias)) {
          candidates.push({
            entity_id: e.id,
            canonical_name: e.name,
            match_type: 'exact_alias',
          });
        }
      }
    }

    const byId = new Map<string, ResolutionCandidate>();
    for (const c of candidates) {
      byId.set(c.entity_id, c);
    }
    const uniq = [...byId.values()];

    if (uniq.length === 1) {
      const c = uniq[0]!;
      return {
        reference_text: referenceText,
        status: 'resolved',
        entity_id: c.entity_id,
        canonical_name: c.canonical_name,
        candidates: uniq,
        confidence: c.match_type === 'exact_alias' ? 0.92 : 0.98,
      };
    }

    if (uniq.length > 1) {
      return {
        reference_text: referenceText,
        status: 'ambiguous',
        entity_id: null,
        canonical_name: null,
        candidates: uniq,
        confidence: 0.5,
      };
    }

    if (/^projeto\s+/i.test(referenceText) || norm.includes('projeto')) {
      const projectLike = this.entities.find((e) => e.entity_type === 'project');
      if (projectLike && tokenMatch(referenceText, projectLike.name)) {
        return {
          reference_text: referenceText,
          status: 'resolved',
          entity_id: projectLike.id,
          canonical_name: projectLike.name,
          candidates: [
            {
              entity_id: projectLike.id,
              canonical_name: projectLike.name,
              match_type: 'exact_name',
            },
          ],
          confidence: 0.85,
        };
      }
    }

    return {
      reference_text: referenceText,
      status: 'unresolved',
      entity_id: null,
      canonical_name: null,
      candidates: [],
      confidence: 0,
    };
  }
}

export function collectReferenceTextsFromExtractor(
  output: import('../openai/extractor-v1.4.types.js').ExtractorOutputV14,
): string[] {
  const texts = new Set<string>();
  for (const m of output.entity_mentions) texts.add(m.mention_text);
  for (const a of output.aliases) {
    texts.add(a.target_reference);
    for (const n of a.negated_former_references) texts.add(n);
  }
  for (const e of output.events) {
    for (const r of e.related_entities) texts.add(r.entity_reference);
  }
  for (const c of output.correction_signals) {
    if (c.previous_reference) texts.add(c.previous_reference);
    if (c.current_reference) texts.add(c.current_reference);
  }
  for (const a of output.assertions) {
    texts.add(a.subject_reference);
    if (a.object_reference) texts.add(a.object_reference);
    for (const r of a.related_entity_references) texts.add(r);
  }
  for (const t of output.task_signals ?? []) {
    if (t.task_reference) texts.add(t.task_reference);
    if (t.title) texts.add(t.title);
    if (t.assignee_reference) texts.add(t.assignee_reference);
    if (t.target_reference) texts.add(t.target_reference);
    if (t.project_reference) texts.add(t.project_reference);
  }
  for (const c of output.clarification_candidates) texts.add(c.target_reference);
  for (const h of output.review_hints) {
    if (h.target_reference) texts.add(h.target_reference);
  }
  return [...texts];
}

/** Entity-like metadata only — routing fields must never become ResolvedReference. */
export function collectEntityLikeTextsFromMetadata(
  entityLike: EntityLikeSourceMetadata,
): string[] {
  const texts: string[] = [];
  if (entityLike.sender_reference?.trim()) {
    texts.push(entityLike.sender_reference);
  }
  for (const r of entityLike.recipient_references ?? []) {
    if (r.trim()) texts.push(r);
  }
  return texts;
}

export function buildTrustedEntityReferencesFromMetadata(
  entityLike: EntityLikeSourceMetadata,
  resolver: ReferenceResolverService,
): Map<string, ResolvedReference> {
  const trusted = new Map<string, ResolvedReference>();
  for (const text of collectEntityLikeTextsFromMetadata(entityLike)) {
    const resolved = resolver.resolveOne(text);
    if (resolved.status === 'resolved') {
      trusted.set(text, resolved);
      trusted.set(normalizeText(text), resolved);
    }
  }
  return trusted;
}
