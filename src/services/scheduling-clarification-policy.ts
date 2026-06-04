import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { ClarificationIssueType } from '../openai/extractor-v1.4.types.js';

const AWAIT_AVAILABILITY = /\b(aguardar|confirmar|confirma[cç][aã]o|disponibilidade|avaliar\s+(a\s+)?disponibilidade)\b/i;
const DELEGATED_CHECK = /\b(vai\s+avaliar|avaliar\s+a\s+disponibilidade|vai\s+confirmar)\b/i;
const VAGUE_DUE_SPLIT = /\b(ou|entre|e\/ou)\b/i;
const WEEKEND_OR_WEEKDAY =
  /\b(s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|sexta|fim\s+de\s+semana|esta\s+semana|pr[oó]xima\s+semana)\b/i;

const SCHEDULING_ISSUE_TYPES = new Set<ClarificationIssueType>([
  'missing_due_date',
  'ambiguous_date',
  'missing_assignee_or_due_date',
]);

const SCHEDULING_QUESTION = /\b(qual\s+dia|que\s+dia|hor[aá]rio|manh[aã]\/tarde|propor.*hor[aá]rio|confirmar\s+para\s+o\s+almo[cç]o)\b/i;

export function isVagueDueWindow(dueAt: string | null | undefined): boolean {
  const t = dueAt?.trim();
  if (!t) return false;
  if (/\bfim\s+de\s+semana\b/i.test(t)) return true;
  if (VAGUE_DUE_SPLIT.test(t) && WEEKEND_OR_WEEKDAY.test(t)) return true;
  return false;
}

export function isAwaitAvailabilityTaskSignal(
  signal: ExtractorOutputV14['task_signals'][number],
): boolean {
  const text = `${signal.title ?? ''} ${signal.source_excerpt} ${signal.target_reference ?? ''}`;
  if (signal.task_kind === 'follow_up' && AWAIT_AVAILABILITY.test(text)) return true;
  return AWAIT_AVAILABILITY.test(text) && /\baguardar\b/i.test(text);
}

export function hasAwaitAvailabilityWithOpenScheduling(output: ExtractorOutputV14): boolean {
  for (const signal of output.task_signals ?? []) {
    if (!isAwaitAvailabilityTaskSignal(signal)) continue;
    if (isVagueDueWindow(signal.due_at)) return true;
    const excerpt = signal.source_excerpt ?? '';
    if (DELEGATED_CHECK.test(excerpt)) return true;
  }

  const raw = output.task_signals?.[0]?.source_excerpt ?? '';
  if (
    DELEGATED_CHECK.test(raw) &&
    output.task_signals?.some((s) => isAwaitAvailabilityTaskSignal(s))
  ) {
    return true;
  }

  return false;
}

export function isSchedulingClarificationIssue(issueType: string): boolean {
  return SCHEDULING_ISSUE_TYPES.has(issueType as ClarificationIssueType);
}

/**
 * Não perguntar dia/horário ao usuário quando a captura já delega a confirmação
 * (ex.: "Breno vai avaliar disponibilidade" + prazo "sábado ou domingo").
 */
export function shouldSuppressSchedulingClarification(
  output: ExtractorOutputV14,
  clarification: {
    issue_type: string;
    question: string;
    reason: string;
    blocking_scope: string;
  },
): boolean {
  if (!hasAwaitAvailabilityWithOpenScheduling(output)) return false;
  if (clarification.blocking_scope === 'external_action') return false;
  if (clarification.blocking_scope === 'task_execution') return false;

  if (isSchedulingClarificationIssue(clarification.issue_type)) return true;

  const text = `${clarification.question} ${clarification.reason}`;
  if (
    clarification.issue_type === 'other' &&
    SCHEDULING_QUESTION.test(text) &&
    WEEKEND_OR_WEEKDAY.test(text)
  ) {
    return true;
  }

  return false;
}
