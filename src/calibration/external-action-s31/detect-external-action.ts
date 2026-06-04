import type { ExtractorOutputV14 } from '../../openai/extractor-v1.4.types.js';

export type ExternalActionDetectionOutcome =
  | 'detected_clarification'
  | 'detected_task_external'
  | 'detected_review_hint'
  | 'not_detected'
  | 'ambiguous_task_only';

export interface ExternalActionDetectionResult {
  outcome: ExternalActionDetectionOutcome;
  detected: boolean;
  signals: string[];
}

export function detectExternalActionSignals(
  output: ExtractorOutputV14,
): ExternalActionDetectionResult {
  const signals: string[] = [];

  for (const c of output.clarification_candidates) {
    if (
      c.issue_type === 'missing_external_action_target' ||
      c.blocking_scope === 'external_action' ||
      c.target_type === 'external_action'
    ) {
      signals.push(
        `clarification:${c.issue_type}:${c.blocking_scope}:${c.target_reference ?? '—'}`,
      );
    }
  }

  for (const t of output.task_signals ?? []) {
    if (t.task_kind === 'external_action') {
      signals.push(`task_signal:external_action:${t.title ?? t.task_reference ?? t.operation}`);
    }
  }

  for (const h of output.review_hints) {
    if (/external|e-?mail|calend[aá]rio|enviar|mandar|agendar|responder/i.test(h.reason)) {
      signals.push(`review_hint:${h.issue_type}:${h.reason.slice(0, 80)}`);
    }
  }

  const hasClarification = signals.some((s) => s.startsWith('clarification:'));
  const hasTaskExternal = signals.some((s) => s.startsWith('task_signal:external_action'));
  const hasReview = signals.some((s) => s.startsWith('review_hint:'));

  if (hasClarification) {
    return { outcome: 'detected_clarification', detected: true, signals };
  }
  if (hasTaskExternal) {
    return { outcome: 'detected_task_external', detected: true, signals };
  }
  if (hasReview) {
    return { outcome: 'detected_review_hint', detected: true, signals };
  }

  const hasGenericTask = (output.task_signals ?? []).some(
    (t) =>
      t.operation === 'create' &&
      /\b(envie|mande|agende|responda|crie)\b/i.test(
        `${t.title ?? ''} ${t.source_excerpt ?? ''}`,
      ),
  );
  if (hasGenericTask) {
    return { outcome: 'ambiguous_task_only', detected: false, signals: ['task_create_without_external_action_signal'] };
  }

  return { outcome: 'not_detected', detected: false, signals };
}
