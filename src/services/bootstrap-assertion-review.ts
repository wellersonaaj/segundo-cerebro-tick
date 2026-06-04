import type { ExtractorOutput } from '../types/domain.js';
import { isBootstrapSourceChannel } from './bootstrap-primary-event.js';

export const BOOTSTRAP_MAX_ASSERTIONS = 100;

export interface BootstrapAssertionReviewResult {
  processing_notes: string[];
  review_reasons: string[];
  requires_review: boolean;
}

/**
 * No artificial assertion cap exists in schema or persistence (no maxItems, slice, or prompt limit).
 * Omissões como as 15 assertions do bootstrap 01 vêm da extração seletiva do modelo.
 */
export function applyBootstrapAssertionReview(
  sourceChannel: string,
  output: ExtractorOutput,
): BootstrapAssertionReviewResult {
  if (!isBootstrapSourceChannel(sourceChannel)) {
    return { processing_notes: [], review_reasons: [], requires_review: false };
  }

  const notes: string[] = [];
  const reasons: string[] = [];
  let requires_review = false;

  notes.push(
    'bootstrap_assertion_completeness_review: revisar se fatos explícitos do panorama foram capturados como assertions (omissões podem vir da extração seletiva do modelo).',
  );

  if (output.assertions.length >= BOOTSTRAP_MAX_ASSERTIONS) {
    notes.push(
      `possible_assertion_truncation: extração atingiu o teto de segurança de ${BOOTSTRAP_MAX_ASSERTIONS} assertions.`,
    );
    reasons.push('possible_assertion_truncation');
    requires_review = true;
  }

  return { processing_notes: notes, review_reasons: reasons, requires_review };
}

export function mergeBootstrapAssertionReview(
  output: ExtractorOutput,
  review: BootstrapAssertionReviewResult,
): ExtractorOutput {
  if (!review.processing_notes.length && !review.review_reasons.length) {
    return output;
  }

  return {
    ...output,
    processing_notes: [...output.processing_notes, ...review.processing_notes],
    review_reasons: [...output.review_reasons, ...review.review_reasons],
    requires_review: output.requires_review || review.requires_review,
  };
}
