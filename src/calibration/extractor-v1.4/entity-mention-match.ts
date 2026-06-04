import { normalizeText } from '../../utils/normalize.js';

/** Exact normalized equality for must_not_have.entity_mentions (no token/substring). */
export function matchesMustNotEntityMention(mentionText: string, forbiddenPattern: string): boolean {
  return normalizeText(mentionText) === normalizeText(forbiddenPattern);
}

/** @deprecated Use matchesMustNotEntityMention — kept for audit diff notes. */
export const matchesMustNot = matchesMustNotEntityMention;

const ENTITY_PRECISION_EXCLUDED_CATEGORIES = new Set([
  'bootstrap_panorama',
  'static_preferences',
  'project_status_update',
  'episodic_meeting',
  'episodic_confirmation',
  'correction_participant',
  'correction_document_sender',
  'task_open',
  'task_blocked',
  'task_completed',
  'task_due_date_change',
  'task_assignee_change',
]);

const ALIAS_FIRST_CATEGORIES = new Set(['alias_negation', 'alias_reassignment']);

export function isEntityPrecisionApplicable(
  category: string,
  mustNot: string[],
  mustHaveAliases: string[],
  mustHaveEntities: string[],
): boolean {
  if (ENTITY_PRECISION_EXCLUDED_CATEGORIES.has(category)) {
    return false;
  }
  if (ALIAS_FIRST_CATEGORIES.has(category)) {
    return false;
  }
  return mustNot.length > 0 || mustHaveEntities.length > 0;
}
