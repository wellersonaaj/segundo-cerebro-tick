import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import {
  isMvpAutoRegistryEntityType,
  isReferenceCentralToTaskSignals,
} from '../config/mvp-registry-policy.js';
import { normalizeText } from '../utils/normalize.js';
import type { EnrichmentTrigger } from '../types/external-knowledge-enrichment.js';

const TEMPORAL_HINT =
  /\b(semana que vem|pr[oó]xima semana|amanh[aã]|hoje|ontem|m[eê]s que vem|\d{1,2}\/\d{1,2})\b/i;

const PRIVATE_PERSON_CONTEXT =
  /\b(nova colaboradora|nosso time|minha equipe|colega|namorad[oa]|irm[aã]|pai|m[aã]e)\b/i;

function inferYear(receivedAt: string | undefined): number {
  if (receivedAt?.trim()) {
    const y = new Date(receivedAt).getFullYear();
    if (!Number.isNaN(y) && y >= 2000) return y;
  }
  return new Date().getFullYear();
}

function isProperNounLike(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (/^(eu|mim|me|rio de janeiro)$/i.test(t)) return false;
  return /[A-ZÀ-Ú]/.test(t) || t.split(/\s+/).length >= 2;
}

export function scanEnrichmentTriggers(
  output: ExtractorOutputV14,
  receivedAt?: string,
): EnrichmentTrigger[] {
  const anchorYear = inferYear(receivedAt);
  const triggers: EnrichmentTrigger[] = [];
  const seen = new Set<string>();

  const add = (trigger: EnrichmentTrigger): void => {
    const key = `${trigger.gapKind}:${normalizeText(trigger.targetReference)}`;
    if (seen.has(key)) return;
    seen.add(key);
    triggers.push(trigger);
  };

  const droppedNonRegistry = output.entity_mentions.filter(
    (m) => !isMvpAutoRegistryEntityType(m.suggested_entity_type),
  );

  for (const ev of output.events) {
    const titleNorm = normalizeText(ev.title);
    const hasTemporal = TEMPORAL_HINT.test(ev.source_excerpt);
    const namedInEvent = ev.related_entities.some((r) =>
      isProperNounLike(r.entity_reference),
    );

    for (const rel of ev.related_entities) {
      const ref = rel.entity_reference;
      if (!isProperNounLike(ref)) continue;
      const mention = droppedNonRegistry.find(
        (m) => normalizeText(m.mention_text) === normalizeText(ref),
      );
      if (mention && mention.suggested_entity_type === 'topic') {
        add({
          targetReference: ref,
          gapKind: 'non_registry_named_reference',
          sourceExcerpt: mention.source_excerpt,
          anchorYear,
        });
      }
    }

    if (ev.occurred_at == null && hasTemporal && namedInEvent) {
      const primaryRef =
        ev.related_entities.find((r) => isProperNounLike(r.entity_reference))
          ?.entity_reference ?? ev.title;
      if (isProperNounLike(primaryRef) && !PRIVATE_PERSON_CONTEXT.test(ev.source_excerpt)) {
        add({
          targetReference: primaryRef,
          gapKind: 'missing_event_date',
          sourceExcerpt: ev.source_excerpt,
          anchorYear,
        });
      }
    }

    void titleNorm;
  }

  for (const c of output.clarification_candidates) {
    if (
      c.issue_type === 'ambiguous_entity_type' &&
      c.blocking_scope === 'knowledge_confirmation' &&
      isProperNounLike(c.target_reference) &&
      isReferenceCentralToTaskSignals(c.target_reference, output.task_signals)
    ) {
      add({
        targetReference: c.target_reference,
        gapKind: 'ambiguous_entity_central',
        sourceExcerpt: c.source_excerpt,
        anchorYear,
      });
    } else if (
      (c.issue_type === 'ambiguous_date' ||
        c.issue_type === 'unclear_scope' ||
        c.issue_type === 'other') &&
      isProperNounLike(c.target_reference) &&
      c.blocking_scope === 'none'
    ) {
      add({
        targetReference: c.target_reference,
        gapKind: 'clarification_external',
        sourceExcerpt: c.source_excerpt,
        anchorYear,
      });
    }
  }

  return triggers;
}

export function buildSearchQueries(trigger: EnrichmentTrigger): string[] {
  const name = trigger.targetReference.trim();
  const year = trigger.anchorYear;
  if (trigger.gapKind === 'ambiguous_entity_central') {
    return [`${name} conference event ${year}`, `${name} what is`];
  }
  if (trigger.gapKind === 'missing_event_date' || trigger.gapKind === 'clarification_external') {
    return [`${name} ${year} dates`, `${name} ${year} official`];
  }
  return [`${name} ${year}`, `${name} ${year} official site`];
}
