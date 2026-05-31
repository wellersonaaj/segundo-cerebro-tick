import type {
  EntityResolutionResult,
  ExtractedClarification,
  ExtractedEvent,
  ExtractorOutput,
} from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import type { ResolvedEntityMap } from './memory-resolver.service.js';

const FORBIDDEN_SECONDARY_INFO =
  /\b(telefone|e-?mail|email|contato|respons[aá]vel|n[uú]mero do contrato|prazo adicional)\b/i;

const ENTITY_TYPE_AMBIGUITY_IN_TEXT =
  /\b(tipo|identidade)\b.*amb[ií]guo?|\bamb[ií]guo?\b.*\b(tipo|genius)\b|genius.*amb[ií]guo?|tipo.*genius.*amb[ií]guo?/i;

const MIN_FORNECEDOR_QUESTION = 'Qual fornecedor deve ser cobrado?';

export interface ClarificationFilterResult {
  remaining: ExtractedClarification[];
  autoResolvedIndices: number[];
}

function isResolvedEntity(
  refNorm: string,
  resolvedMap: ResolvedEntityMap,
  resolutions: EntityResolutionResult[],
): boolean {
  if (resolvedMap.byExtractedName.has(refNorm)) return true;
  return resolutions.some(
    (r) => r.status === 'resolved' && normalizeText(r.extractedName) === refNorm,
  );
}

function isEntityTypeAmbiguityClarification(c: ExtractedClarification): boolean {
  if (c.issue_type === 'ambiguous_entity_type' || c.issue_type === 'ambiguous_entity_identity') {
    return true;
  }
  const blob = `${c.question} ${c.reason} ${c.target_reference}`;
  return ENTITY_TYPE_AMBIGUITY_IN_TEXT.test(blob);
}

function isObsoleteEntityTypeReviewReason(
  reason: string,
  resolutions: EntityResolutionResult[],
): boolean {
  if (!ENTITY_TYPE_AMBIGUITY_IN_TEXT.test(reason)) return false;
  const reasonNorm = normalizeText(reason);
  return resolutions.some((r) => {
    if (r.status !== 'resolved' || r.confidence < 0.75) return false;
    const nameNorm = normalizeText(r.extractedName);
    return reasonNorm.includes(nameNorm);
  });
}

export function filterClarificationsAfterResolution(
  clarifications: ExtractedClarification[],
  resolvedMap: ResolvedEntityMap,
  resolutions: EntityResolutionResult[],
): ClarificationFilterResult {
  const remaining: ExtractedClarification[] = [];
  const autoResolvedIndices: number[] = [];

  clarifications.forEach((c, index) => {
    const refNorm = normalizeText(c.target_reference);

    if (isEntityTypeAmbiguityClarification(c) && isResolvedEntity(refNorm, resolvedMap, resolutions)) {
      autoResolvedIndices.push(index);
      return;
    }

    remaining.push(sanitizeClarification(c, resolutions));
  });

  return { remaining, autoResolvedIndices };
}

export function filterReviewReasonsAfterResolution(
  reviewReasons: string[],
  resolutions: EntityResolutionResult[],
): string[] {
  return reviewReasons.filter((r) => !isObsoleteEntityTypeReviewReason(r, resolutions));
}

function sanitizeClarification(
  c: ExtractedClarification,
  resolutions: EntityResolutionResult[],
): ExtractedClarification {
  if (c.issue_type !== 'missing_task_target') {
    return stripForbiddenFromClarification(c);
  }

  const isFornecedor =
    /fornecedor/i.test(c.target_reference) ||
    /fornecedor/i.test(c.question) ||
    /fornecedor/i.test(c.source_excerpt);

  let question = c.question;
  let reason = c.reason;
  if (isFornecedor) {
    question = MIN_FORNECEDOR_QUESTION;
    if (FORBIDDEN_SECONDARY_INFO.test(reason)) {
      reason = 'A tarefa não identifica qual fornecedor deve ser cobrado.';
    }
  } else if (FORBIDDEN_SECONDARY_INFO.test(c.question)) {
    question = c.question.replace(FORBIDDEN_SECONDARY_INFO, '').replace(/\s+/g, ' ').trim();
    if (!question.endsWith('?')) question = `${question}?`;
  }
  if (FORBIDDEN_SECONDARY_INFO.test(reason)) {
    reason = reason.replace(FORBIDDEN_SECONDARY_INFO, '').replace(/\s+/g, ' ').trim();
  }

  let suggested_answers = (c.suggested_answers ?? []).filter((a) => !FORBIDDEN_SECONDARY_INFO.test(a));

  const needsMinimalSuggestions =
    FORBIDDEN_SECONDARY_INFO.test(c.question) ||
    FORBIDDEN_SECONDARY_INFO.test(c.reason) ||
    (c.suggested_answers ?? []).some((a) => FORBIDDEN_SECONDARY_INFO.test(a));

  if (isFornecedor && needsMinimalSuggestions) {
    const resolvedSupplier = resolutions.find(
      (r) => r.status === 'resolved' && r.resolvedEntityName && r.confidence >= 0.75,
    );
    suggested_answers = resolvedSupplier?.resolvedEntityName
      ? [resolvedSupplier.resolvedEntityName, 'Outro fornecedor']
      : ['Genius Hotels', 'Outro fornecedor'];
  }

  return stripForbiddenFromClarification({
    ...c,
    question,
    reason,
    suggested_answers,
  });
}

function stripForbiddenFromClarification(c: ExtractedClarification): ExtractedClarification {
  return {
    ...c,
    suggested_answers: (c.suggested_answers ?? []).filter((a) => !FORBIDDEN_SECONDARY_INFO.test(a)),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceEntityToken(text: string, extracted: string, resolved: string): string {
  const re = new RegExp(`\\b${escapeRegExp(extracted)}\\b`, 'gi');
  return text.replace(re, resolved);
}

function extractEntityPhraseFromExcerpt(excerpt: string, entityName: string): string | null {
  const re = new RegExp(
    `((?:da|de|do|a|com|sobre)\\s+(?:[\\wÀ-ú]+\\s+){0,4})?\\b${escapeRegExp(entityName)}\\b`,
    'i',
  );
  const m = excerpt.match(re);
  if (!m) return null;
  const phrase = m[0].trim();
  return phrase.length > entityName.length ? phrase : `da ${entityName}`;
}

function insertEntityPhraseIntoDescription(description: string, phrase: string): string {
  const descNorm = normalizeText(description);
  const phraseNorm = normalizeText(phrase);
  if (descNorm.includes(phraseNorm)) return description;

  const sobreMatch = description.match(/\bsobre\s+(\S+(?:\s+\S+){0,3})\b/i);
  if (sobreMatch) {
    const anchor = sobreMatch[1]!;
    if (!normalizeText(anchor).includes(normalizeText(phrase))) {
      return description.replace(sobreMatch[0], `sobre ${anchor} ${phrase}`);
    }
  }

  const integracaoMatch = description.match(/\bintegra[cç][aã]o\b/i);
  if (integracaoMatch && (phraseNorm.includes('da') || phraseNorm.includes('de'))) {
    return description.replace(integracaoMatch[0], `${integracaoMatch[0]} ${phrase}`);
  }

  return `${description} ${phrase}`.trim();
}

export function enrichEventDescriptionFromResolution(
  event: ExtractedEvent,
  resolutions: EntityResolutionResult[],
): ExtractedEvent {
  let description = event.description;
  const excerpt = event.source_excerpt;

  for (const r of resolutions) {
    if (r.status !== 'resolved' || !r.resolvedEntityName) continue;

    const extracted = r.extractedName;
    const descHasExtracted = normalizeText(description).includes(normalizeText(extracted));
    const descHasResolved = normalizeText(description).includes(normalizeText(r.resolvedEntityName));
    const excerptHasExtracted = normalizeText(excerpt).includes(normalizeText(extracted));

    if (excerptHasExtracted && !descHasExtracted && !descHasResolved) {
      const phrase = extractEntityPhraseFromExcerpt(excerpt, extracted);
      if (phrase) {
        description = insertEntityPhraseIntoDescription(description, phrase);
      }
    }

    if (r.confidence >= 0.9 && normalizeText(description).includes(normalizeText(extracted))) {
      description = replaceEntityToken(description, extracted, r.resolvedEntityName);
    }
  }

  return { ...event, description };
}

export function sanitizeEventsAfterResolution(
  events: ExtractedEvent[],
  resolutions: EntityResolutionResult[],
): ExtractedEvent[] {
  return events.map((e) => enrichEventDescriptionFromResolution(e, resolutions));
}

export function deriveRequiresReview(
  original: boolean,
  reviewReasons: string[],
  clarifications: ExtractedClarification[],
): boolean {
  if (reviewReasons.length > 0) return true;
  if (clarifications.some((c) => c.priority === 'high' || c.blocking_scope === 'external_action')) {
    return true;
  }
  return original && clarifications.length > 0;
}

export function applyPostResolutionSanitization(
  output: ExtractorOutput,
  resolvedMap: ResolvedEntityMap,
  clarificationFilter: ClarificationFilterResult,
): ExtractorOutput {
  const review_reasons = filterReviewReasonsAfterResolution(
    output.review_reasons,
    resolvedMap.resolutions,
  );
  const clarification_requests = clarificationFilter.remaining;
  const events = sanitizeEventsAfterResolution(output.events, resolvedMap.resolutions);

  return {
    ...output,
    events,
    clarification_requests,
    review_reasons,
    requires_review: deriveRequiresReview(
      output.requires_review,
      review_reasons,
      clarification_requests,
    ),
  };
}
