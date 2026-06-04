import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { SourceMode } from '../types/domain.js';
import { isPersonalMeetingEvent } from './enrichment-eligibility.js';

const IMPLICIT_FIRST_PERSON_ASSIGNMENT =
  /\b(marquei|agendei|combinei|vou|preciso|tenho que|devo|irei|vou precisar|eu mesmo)\b/i;

export function hasImplicitFirstPersonAssignee(text: string): boolean {
  return IMPLICIT_FIRST_PERSON_ASSIGNMENT.test(text);
}

export function shouldSkipAssigneeUncertaintyGap(
  signal: ExtractorOutputV14['task_signals'][number],
  sourceMode: SourceMode,
): boolean {
  if (sourceMode !== 'conversational') return false;
  if (signal.assignee_reference?.trim()) return true;
  const text = `${signal.source_excerpt} ${signal.title ?? ''}`;
  return hasImplicitFirstPersonAssignee(text);
}

export function applyImplicitAssigneeToOutput(
  output: ExtractorOutputV14,
  sourceMode: SourceMode,
  rawContent: string,
): ExtractorOutputV14 {
  if (sourceMode !== 'conversational') return output;

  const task_signals = (output.task_signals ?? []).map((signal) => {
    if (signal.assignee_reference?.trim()) return signal;
    const text = signal.source_excerpt?.trim() || rawContent;
    if (!hasImplicitFirstPersonAssignee(text)) return signal;
    return { ...signal, assignee_reference: 'eu' };
  });

  return { ...output, task_signals };
}

export function isSocialCommitmentTaskSignal(
  signal: ExtractorOutputV14['task_signals'][number],
  output: ExtractorOutputV14,
): boolean {
  const text = `${signal.source_excerpt} ${signal.title ?? ''} ${signal.target_reference ?? ''}`;
  if (/\b(encontrar|encontro|jantar|almoç|almoc|call|ligar|marcar)\b/i.test(text)) {
    return true;
  }
  return output.events.some(
    (ev) => ev.event_kind === 'meeting' && isPersonalMeetingEvent(ev, output),
  );
}

export function suppressPronounClarifications(
  output: ExtractorOutputV14,
  resolvedPronouns: Set<string>,
): ExtractorOutputV14 {
  if (!resolvedPronouns.size) return output;

  const clarification_candidates = output.clarification_candidates.filter((c) => {
    const ref = normalizeRef(c.target_reference);
    return !resolvedPronouns.has(ref);
  });

  const review_hints = output.review_hints.filter((h) => {
    const ref = h.target_reference ? normalizeRef(h.target_reference) : '';
    if (!ref) return true;
    if (h.issue_type !== 'ambiguous_identity' && h.issue_type !== 'unresolved_reference') {
      return true;
    }
    return !resolvedPronouns.has(ref);
  });

  return { ...output, clarification_candidates, review_hints };
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}
