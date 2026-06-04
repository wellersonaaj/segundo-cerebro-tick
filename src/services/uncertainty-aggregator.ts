import type { ExtractorOutputV14, ReviewHint } from '../openai/extractor-v1.4.types.js';
import type { ClarificationRequest } from '../types/domain.js';
import type { EnrichmentTrigger } from '../types/external-knowledge-enrichment.js';
import { normalizeText } from '../utils/normalize.js';
import { isTelegramPromptableClarification } from '../telegram/telegram-metadata.js';

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

const TEMPORAL_HINT =
  /\b(semana que vem|pr[oó]xima semana|amanh[aã]|hoje|ontem|m[eê]s que vem|sexta|segunda|terça|quarta|quinta|sábado|domingo|\d{1,2}\/\d{1,2})\b/i;

const REVIEW_HINT_PRIORITY: Record<ReviewHint['issue_type'], number> = {
  ambiguous_identity: 90,
  unresolved_reference: 85,
  ambiguous_entity_type: 80,
  possible_contradiction: 70,
  low_confidence_event: 60,
  other: 50,
};

function isProperNounLike(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (/^(eu|mim|me|rio de janeiro)$/i.test(t)) return false;
  return /[A-ZÀ-Ú]/.test(t) || t.split(/\s+/).length >= 2;
}

function gapKey(kind: string, ref: string): string {
  return `${kind}:${normalizeText(ref)}`;
}

export function aggregateUncertaintyGaps(input: {
  clarifications: ClarificationRequest[];
  extractorOutput?: ExtractorOutputV14 | null;
  maxGaps?: number;
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
    if (!isTelegramPromptableClarification(c)) continue;
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
      if (!isProperNounLike(ref)) continue;
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
        const parts: string[] = [];
        if (missingAssignee) parts.push('quem fica responsável');
        if (missingDue) parts.push('qual o prazo');
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
      if (!TEMPORAL_HINT.test(ev.source_excerpt)) continue;
      const ref =
        ev.related_entities.find((r) => isProperNounLike(r.entity_reference))?.entity_reference ??
        ev.title;
      add({
        kind: 'temporal',
        target_reference: ref,
        question: `Quando acontece ${ref}?`,
        suggested_answers: [],
        source_excerpt: ev.source_excerpt,
        priority: 60,
      });
    }
  }

  gaps.sort((a, b) => b.priority - a.priority);
  return gaps.slice(0, max);
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
