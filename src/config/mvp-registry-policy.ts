import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import { normalizeText } from '../utils/normalize.js';

/** MVP S1: only these types may enter automatic canonical registry. */
export const MVP_AUTO_REGISTRY_ENTITY_TYPES = [
  'person',
  'company',
  'project',
  'product',
] as const;

export type MvpAutoRegistryEntityType = (typeof MVP_AUTO_REGISTRY_ENTITY_TYPES)[number];

const MVP_AUTO_REGISTRY_SET = new Set<string>(MVP_AUTO_REGISTRY_ENTITY_TYPES);

export function isMvpAutoRegistryEntityType(
  suggestedEntityType: string | null | undefined,
): boolean {
  return suggestedEntityType != null && MVP_AUTO_REGISTRY_SET.has(suggestedEntityType);
}

/**
 * Registry-eligible when the reference matches an entity_mention whose suggested type
 * is in the MVP auto-registry allowlist (exact normalized match on mention_text).
 */
export function isMvpRegistryEligibleReference(
  referenceText: string,
  extractorOutput: Pick<ExtractorOutputV14, 'entity_mentions'>,
): boolean {
  const refNorm = normalizeText(referenceText);
  return extractorOutput.entity_mentions.some(
    (m) =>
      isMvpAutoRegistryEntityType(m.suggested_entity_type) &&
      normalizeText(m.mention_text) === refNorm,
  );
}

export function peripheralAmbiguityNote(referenceText: string): string {
  return `peripheral_ambiguity_ignored: ${referenceText}`;
}

/**
 * True when a reference is the explicit target or named subject of a task signal
 * (e.g. "ESX" in target_reference or task title), not merely incidental context.
 */
export function isReferenceCentralToTaskSignals(
  referenceText: string,
  taskSignals: ExtractorOutputV14['task_signals'],
): boolean {
  const refNorm = normalizeText(referenceText);
  if (!refNorm || refNorm.length < 2) return false;

  for (const task of taskSignals) {
    if (task.target_reference && normalizeText(task.target_reference) === refNorm) {
      return true;
    }
    const titleNorm = normalizeText(task.title);
    if (titleNorm.includes(refNorm)) {
      return true;
    }
  }
  return false;
}

/** S3.1: exact-match blocklist — generic or metalinguistic terms must not become canonical entities. */
export const MVP_BLOCKED_GENERIC_ENTITY_TERMS = [
  'cliente',
  'fornecedor',
  'empresa',
  'pessoa',
  'person',
  'company',
  'project',
  'product',
] as const;

export function isMvpBlockedGenericEntityTerm(mentionText: string): boolean {
  const norm = normalizeText(mentionText);
  return MVP_BLOCKED_GENERIC_ENTITY_TERMS.some((t) => normalizeText(t) === norm);
}

export function genericEntityTermDropNote(mentionText: string): string {
  return `generic_entity_term_dropped: ${mentionText}`;
}
