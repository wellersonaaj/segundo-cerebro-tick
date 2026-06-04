import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';

export interface AnsweredClarificationSlice {
  question: string;
  answer: string;
  issue_type: string;
  target_reference: string;
}

const CONFIRMATION_TOPIC =
  /\b(confirma|disponibilidade|pendente|aguardando|almo[cç]o|breno)\b/i;

const AVAILABILITY_RESOLVED_ANSWER =
  /\b(apenas|somente|s[oó])\s+(a\s+)?disponibilidade|disponibilidade\s+(confirmada|ok)|confirmou\s+(a\s+)?disponibilidade|confirmou\s+que\s+pode|pode\s+almo[cç]ar\s+sem\s+dia|sem\s+dia\s+definido/i;

const STILL_PENDING_ANSWER =
  /\b(ainda\s+n[aã]o|aguardando|pendente|sem\s+confirma[cç][aã]o)/i;

const DAY_IN_ANSWER = /\b(s[aá]bado|domingo|manh[aã]|tarde|hor[aá]rio)\b/i;

export function isConfirmationStateClarificationTopic(text: string): boolean {
  return CONFIRMATION_TOPIC.test(text);
}

export function answeredClarificationResolvesConfirmationState(
  answered: AnsweredClarificationSlice[],
): boolean {
  return answered.some((a) => {
    const blob = `${a.question} ${a.answer} ${a.issue_type} ${a.target_reference}`;
    if (!isConfirmationStateClarificationTopic(blob)) return false;
    return AVAILABILITY_RESOLVED_ANSWER.test(a.answer) || STILL_PENDING_ANSWER.test(a.answer);
  });
}

export function clarificationBundlesDayWithConfirmation(clarification: {
  question: string;
  suggested_answers?: string[];
}): boolean {
  const blob = `${clarification.question} ${(clarification.suggested_answers ?? []).join(' ')}`;
  if (!isConfirmationStateClarificationTopic(blob)) return false;
  return DAY_IN_ANSWER.test(blob) && /\b(confirma|disponibilidade|pendente|pode\s+almo)/i.test(blob);
}

export function shouldSuppressConfirmationContradictionClarification(
  clarification: {
    issue_type: string;
    question: string;
    reason: string;
    target_reference: string;
    suggested_answers?: string[];
  },
  answered: AnsweredClarificationSlice[],
): boolean {
  if (clarification.issue_type !== 'possible_contradiction') return false;
  const topic = `${clarification.question} ${clarification.reason} ${clarification.target_reference}`;
  if (!isConfirmationStateClarificationTopic(topic)) return false;

  if (answeredClarificationResolvesConfirmationState(answered)) return true;

  if (clarificationBundlesDayWithConfirmation(clarification)) return true;

  return false;
}

export function suppressStaleConfirmationContradictions(
  output: ExtractorOutputV14,
  answered: AnsweredClarificationSlice[],
): ExtractorOutputV14 {
  if (!answeredClarificationResolvesConfirmationState(answered)) return output;

  const clarification_candidates = (output.clarification_candidates ?? []).filter(
    (c) =>
      !shouldSuppressConfirmationContradictionClarification(
        {
          issue_type: c.issue_type,
          question: c.question,
          reason: c.reason,
          target_reference: c.target_reference,
          suggested_answers: c.suggested_answers,
        },
        answered,
      ),
  );

  const review_hints = (output.review_hints ?? []).filter((h) => {
    if (h.issue_type !== 'possible_contradiction') return true;
    return !isConfirmationStateClarificationTopic(`${h.reason} ${h.target_reference ?? ''}`);
  });

  return { ...output, clarification_candidates, review_hints };
}

/** Respostas livres comuns no Telegram quando há 3+ opções de confirmação. */
export function expandClarificationAnswerFromOptions(
  answer: string,
  suggestedAnswers: string[],
): string {
  const trimmed = answer.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index >= 0 && index < suggestedAnswers.length) {
      return suggestedAnswers[index]!;
    }
  }
  if (/^(3|tr[eê]s)$/i.test(trimmed) && /disponibilidade/i.test(suggestedAnswers.join(' '))) {
    const hit = suggestedAnswers.find((s) => /apenas|somente|disponibilidade/i.test(s));
    if (hit) return hit;
    return 'Breno confirmou apenas a disponibilidade (dia ainda não definido)';
  }
  if (/apenas.*disponibilidade|somente.*disponibilidade/i.test(trimmed)) {
    return 'Breno confirmou apenas a disponibilidade (dia ainda não definido)';
  }
  return trimmed;
}
