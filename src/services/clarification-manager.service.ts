import type { AliasConflict } from './entity-upsert.service.js';
import type { ResolvedEntityMap } from './memory-resolver.service.js';
import type { CompilerFlags } from '../types/memory-compiler.js';
import type { CompiledClarificationCandidate } from '../types/memory-compiler.js';
import type { EntityResolutionResult, ExtractedClarification } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import {
  filterClarificationsAfterResolution,
  FORBIDDEN_SECONDARY_INFO,
} from './extraction-sanitizer.service.js';

const ENTITY_TYPE_AMBIGUITY_IN_TEXT =
  /\b(tipo|identidade)\b.*amb[ií]guo?|\bamb[ií]guo?\b.*\b(tipo|genius)\b/i;

export interface ClarificationManagerInput {
  suggestedClarifications: ExtractedClarification[];
  resolvedMap: ResolvedEntityMap;
  upsertConflicts?: AliasConflict[];
  compilerFlags: CompilerFlags;
}

export class ClarificationManagerService {
  recommend(input: ClarificationManagerInput): CompiledClarificationCandidate[] {
    const { suggestedClarifications, resolvedMap, compilerFlags } = input;
    const upsertConflicts = input.upsertConflicts ?? [];

    const filtered = filterClarificationsAfterResolution(
      suggestedClarifications,
      resolvedMap,
      resolvedMap.resolutions,
    );

    const recommended: CompiledClarificationCandidate[] = [];

    for (const c of filtered.remaining) {
      if (this.shouldDrop(c, resolvedMap.resolutions, compilerFlags, upsertConflicts)) {
        continue;
      }
      recommended.push({
        targetType: c.target_type,
        targetReference: c.target_reference,
        issueType: c.issue_type,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        blockingScope: c.blocking_scope,
        suggestedAnswers: c.suggested_answers ?? [],
        sourceExcerpt: c.source_excerpt,
      });
    }

    for (const conflict of upsertConflicts) {
      recommended.push({
        targetType: 'entity',
        targetReference: conflict.alias,
        issueType: 'ambiguous_entity_identity',
        question: `O alias "${conflict.alias}" já está associado a ${conflict.existingEntityName}. Confirmar associação com ${conflict.targetEntityName}?`,
        reason: 'alias_conflict',
        priority: 'high',
        blockingScope: 'knowledge_confirmation',
        suggestedAnswers: [conflict.existingEntityName, conflict.targetEntityName],
        sourceExcerpt: conflict.alias,
      });
    }

    return recommended;
  }

  private shouldDrop(
    c: ExtractedClarification,
    resolutions: EntityResolutionResult[],
    flags: CompilerFlags,
    upsertConflicts: AliasConflict[],
  ): boolean {
    const refNorm = normalizeText(c.target_reference);

    if (flags.blockedClarificationRefs.some((b) => refNorm.includes(normalizeText(b)))) {
      return true;
    }

    if (FORBIDDEN_SECONDARY_INFO.test(`${c.question} ${c.reason}`)) {
      return true;
    }

    const resolved = resolutions.find(
      (r) =>
        r.status === 'resolved' &&
        (normalizeText(r.extractedName) === refNorm ||
          normalizeText(r.resolvedEntityName ?? '') === refNorm),
    );
    if (
      resolved &&
      (c.issue_type === 'ambiguous_entity_type' || c.issue_type === 'ambiguous_entity_identity')
    ) {
      return true;
    }

    if (
      c.issue_type === 'ambiguous_entity_type' &&
      ENTITY_TYPE_AMBIGUITY_IN_TEXT.test(`${c.question} ${c.reason}`) &&
      resolved
    ) {
      return true;
    }

    const isGenericOnlyClarification =
      flags.weakTopicsPreserved.some((t) => refNorm === normalizeText(t)) &&
      c.issue_type !== 'missing_task_target' &&
      c.issue_type !== 'missing_external_action_target';

    if (isGenericOnlyClarification) {
      return true;
    }

    if (
      upsertConflicts.some((x) => normalizeText(x.alias) === refNorm) &&
      c.issue_type === 'ambiguous_entity_identity'
    ) {
      return false;
    }

    if (c.blocking_scope === 'none' && c.priority === 'low') {
      return true;
    }

    return false;
  }
}
