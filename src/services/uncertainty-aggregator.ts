import type { ExtractorOutputV14, ReviewHint } from '../openai/extractor-v1.4.types.js';
import type { CompiledEntityReference } from '../types/memory-compiler-v2.js';
import type { ClarificationRequest } from '../types/domain.js';
import type { EnrichmentTrigger } from '../types/external-knowledge-enrichment.js';
import {
  excerptHasRelativeTemporalHint,
  isPersonalMeetingEvent,
} from './enrichment-eligibility.js';
import {
  isSocialCommitmentTaskSignal,
  shouldSkipAssigneeUncertaintyGap,
} from './implicit-assignee.service.js';
import {
  isThirdPersonObjectPronoun,
} from './pronoun-coreference.service.js';
import type { SourceMode } from '../types/domain.js';
import type { MemoryResolverResult } from './reference-resolver.service.js';
import { normalizeText } from '../utils/normalize.js';
import type { AnsweredClarificationSlice } from './confirmation-clarification-policy.js';
import { isTelegramPromptableClarification } from '../telegram/telegram-metadata.js';

const REVIEW_HINT_PRIORITY: Record<ReviewHint['issue_type'], number> = {
  ambiguous_identity: 90,
  unresolved_reference: 85,
  ambiguous_entity_type: 80,
  possible_contradiction: 70,
  low_confidence_event: 60,
  other: 50,
};

export type UncertaintyGapKind =
  | 'clarification'
  | 'review_hint'
  | 'unresolved_entity'
  | 'temporal'
  | 'assignee_or_due';

export interface UncertaintyGap {
  kind: UncertaintyGapKind;
  target_reference: string;
  question: string;
  suggested_answers: string[];
  source_excerpt: string;
  clarification_id?: string;
  priority: number;
}

function isProperNounLike(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (/^(eu|mim|me|rio de janeiro)$/i.test(t)) return false;
  return /[A-ZÀ-Ú]/.test(t) || t.split(/\s+/).length >= 2;
}

function isNonEntityLiteral(ref: string): boolean {
  const t = ref.trim();
  if (/^\d+(\.\d+)?\s*(reais?|r\$|%|kg|km|h|min|s|gr|ml|l)\b/i.test(t)) return true;
  if (/^[\d.,]+\s*(reais?|r\$)/i.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/i.test(t)) return true;
  return false;
}

/**
 * Tipos de entity_mention que NÃO devem virar gaps.
 * Defesa primária: o LLM já classificou corretamente.
 * Se o tipo é um desses, é contexto (tempo, medida, número), não entity ambígua.
 */
const NON_ENTITY_TYPES = new Set([
  'temporal',
  'time',
  'date',
  'datetime',
  'duration',
  'frequency',
  'measurement',
  'currency',
  'amount',
  'value',
  'age',
  'quantity',
  'number',
  'metric',
]);

function gapKey(kind: string, ref: string): string {
  return `${kind}:${normalizeText(ref)}`;
}

export function aggregateUncertaintyGaps(input: {
  clarifications: ClarificationRequest[];
  extractorOutput?: ExtractorOutputV14 | null;
  maxGaps?: number;
  sourceMode?: SourceMode;
  resolverResult?: MemoryResolverResult | null;
  resolvedEntities?: CompiledEntityReference[] | null;
  answeredClarifications?: AnsweredClarificationSlice[];
}): UncertaintyGap[] {
  const max = input.maxGaps ?? 2;
  const seen = new Set<string>();
  const gaps: UncertaintyGap[] = [];

  const add = (gap: UncertaintyGap): void => {
    const key = gapKey(gap.kind, gap.target_reference);
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push(gap);
  };

  for (const c of input.clarifications) {
    if (!isTelegramPromptableClarification(c, input.answeredClarifications ?? [])) continue;
    if (
      isThirdPersonObjectPronoun(c.target_reference) &&
      isPronounResolvedInRegistry(c.target_reference, input.resolverResult)
    ) {
      continue;
    }
    add({
      kind: 'clarification',
      target_reference: c.target_reference,
      question: c.question,
      suggested_answers: c.suggested_answers ?? [],
      source_excerpt: c.source_excerpt,
      clarification_id: c.id,
      priority: c.blocking_scope === 'knowledge_confirmation' ? 95 : 75,
    });
  }

  const output = input.extractorOutput;
  if (output) {
    for (const hint of output.review_hints) {
      const ref = hint.target_reference?.trim();
      if (!ref) continue;
      if (
        hint.issue_type === 'ambiguous_identity' ||
        hint.issue_type === 'unresolved_reference' ||
        hint.issue_type === 'ambiguous_entity_type'
      ) {
        if (
          isThirdPersonObjectPronoun(ref) &&
          (isPronounResolvedInRegistry(ref, input.resolverResult) ||
            isPronounResolvedInCompiledEntities(ref, input.resolvedEntities))
        ) {
          continue;
        }
        add({
          kind: 'review_hint',
          target_reference: ref,
          question: `Sobre "${ref}": ${hint.reason}`,
          suggested_answers: [],
          source_excerpt: hint.source_excerpt,
          priority: REVIEW_HINT_PRIORITY[hint.issue_type] ?? 50,
        });
      }
    }

    for (const mention of output.entity_mentions) {
      const ref = mention.mention_text.trim();
      if (isNonEntityLiteral(ref)) continue;
      if (!isProperNounLike(ref)) continue;
      // Defesa primária: se o LLM já disse que NÃO é entity, respeita.
      if (NON_ENTITY_TYPES.has(mention.suggested_entity_type)) continue;
      if (mention.suggested_entity_type === 'other' || mention.suggested_entity_type === 'topic') {
        add({
          kind: 'unresolved_entity',
          target_reference: ref,
          question: `O que é ${ref}?`,
          suggested_answers: [],
          source_excerpt: mention.source_excerpt,
          priority: 65,
        });
      }
    }

    for (const task of output.task_signals) {
      const missingAssignee = !task.assignee_reference?.trim();
      const missingDue = !task.due_at?.trim();
      if (missingAssignee || missingDue) {
        if (
          missingAssignee &&
          (shouldSkipAssigneeUncertaintyGap(task, input.sourceMode ?? 'conversational') ||
            isSocialCommitmentTaskSignal(task, output))
        ) {
          if (!missingDue) continue;
        }
        const parts: string[] = [];
        if (missingAssignee && !shouldSkipAssigneeUncertaintyGap(task, input.sourceMode ?? 'conversational')) {
          parts.push('quem fica responsável');
        }
        if (missingDue) parts.push('qual o prazo');
        if (!parts.length) continue;
        add({
          kind: 'assignee_or_due',
          target_reference: task.title?.trim() || task.target_reference?.trim() || 'tarefa',
          question: `Para "${task.title ?? task.target_reference}": ${parts.join(' e ')}?`,
          suggested_answers: [],
          source_excerpt: task.source_excerpt,
          priority: 55,
        });
      }
    }

    for (const ev of output.events) {
      if (ev.occurred_at != null) continue;
      if (excerptHasRelativeTemporalHint(ev.source_excerpt)) continue;
      if (isPersonalMeetingEvent(ev, output)) continue;
      add({
        kind: 'temporal',
        target_reference: ev.title,
        question: `Qual a data de "${ev.title}"?`,
        suggested_answers: [],
        source_excerpt: ev.source_excerpt,
        priority: 60,
      });
    }
  }

  gaps.sort((a, b) => b.priority - a.priority);
  return gaps.slice(0, max);
}

function isPronounResolvedInRegistry(
  reference: string,
  resolverResult?: MemoryResolverResult | null,
): boolean {
  if (!resolverResult) return false;
  const hit =
    resolverResult.byReferenceText.get(reference) ??
    resolverResult.byReferenceText.get(normalizeText(reference));
  return hit?.status === 'resolved' && hit.entity_id != null;
}

function isPronounResolvedInCompiledEntities(
  reference: string,
  resolvedEntities?: CompiledEntityReference[] | null,
): boolean {
  if (!resolvedEntities?.length) return false;
  const key = normalizeText(reference);
  const hit = resolvedEntities.find((e) => normalizeText(e.mentionText) === key);
  return hit?.resolutionStatus === 'resolved' && hit.entityId != null;
}

export function filterPersistableEphemeralGaps(
  gaps: UncertaintyGap[],
  clarifications: ClarificationRequest[] = [],
): UncertaintyGap[] {
  const pendingRefs = new Set(
    clarifications
      .filter((c) => c.status === 'pending')
      .map((c) => normalizeText(c.target_reference ?? '')),
  );

  return gaps.filter((g) => {
    if (g.clarification_id) return false;
    const ref = normalizeText(g.target_reference);
    if (pendingRefs.has(ref)) return false;
    if (g.kind === 'review_hint' && isThirdPersonObjectPronoun(g.target_reference)) {
      return false;
    }
    return true;
  });
}

export function uncertaintyGapsToEnrichmentTriggers(
  gaps: UncertaintyGap[],
  anchorYear: number,
): EnrichmentTrigger[] {
  const triggers: EnrichmentTrigger[] = [];
  const seen = new Set<string>();

  for (const gap of gaps) {
    if (!isProperNounLike(gap.target_reference)) continue;
    if (gap.kind === 'assignee_or_due') continue;
    const key = normalizeText(gap.target_reference);
    if (seen.has(key)) continue;
    seen.add(key);
    triggers.push({
      targetReference: gap.target_reference,
      gapKind:
        gap.kind === 'temporal'
          ? 'missing_event_date'
          : gap.kind === 'clarification'
            ? 'ambiguous_entity_central'
            : 'clarification_external',
      sourceExcerpt: gap.source_excerpt,
      anchorYear,
    });
  }
  return triggers;
}
