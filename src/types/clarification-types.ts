import type { CompiledClarificationCandidateV2 } from './memory-compiler-v2.js';

export type ClarificationMateriality = 'blocking' | 'non_blocking' | 'discarded';

/** Valores persistidos em clarification_requests (check constraint no DB). */
export type PersistedClarificationMateriality = 'blocking' | 'non_blocking';

export function materialityFromFields(fields: {
  blocking_scope: string;
  issue_type: string;
  priority: string;
}): PersistedClarificationMateriality {
  const isKcIdentity =
    fields.blocking_scope === 'knowledge_confirmation' &&
    (fields.issue_type === 'ambiguous_entity_identity' ||
      (fields.issue_type === 'ambiguous_entity_type' && fields.priority === 'high'));
  const isBlocking =
    fields.blocking_scope === 'external_action' ||
    isKcIdentity ||
    (fields.blocking_scope !== 'none' &&
      fields.blocking_scope !== 'knowledge_confirmation' &&
      fields.blocking_scope !== 'enrichment' &&
      fields.priority !== 'low');
  return isBlocking ? 'blocking' : 'non_blocking';
}

export interface ClassifiedClarificationV2 extends CompiledClarificationCandidateV2 {
  materiality: ClarificationMateriality;
}

export interface ClarificationManagerV2Result {
  blocking: ClassifiedClarificationV2[];
  nonBlocking: ClassifiedClarificationV2[];
  discarded: ClassifiedClarificationV2[];
}

export interface FinalClarificationDecision {
  status: 'accepted' | 'needs_clarification';
  blockingCount: number;
  nonBlockingCount: number;
  discardedCount: number;
}

export function classifyClarifications(
  candidates: CompiledClarificationCandidateV2[],
): ClarificationManagerV2Result {
  const seen = new Set<string>();
  const blocking: ClassifiedClarificationV2[] = [];
  const nonBlocking: ClassifiedClarificationV2[] = [];
  const discarded: ClassifiedClarificationV2[] = [];

  for (const c of candidates) {
    const key = `${c.issueType}:${c.targetReference}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // external_action sempre bloqueia; enrichment sempre non_blocking
    // knowledge_confirmation: non_blocking por padrão, EXCETO ambiguous_entity_identity (diretriz §7)
    const materiality = materialityFromFields({
      blocking_scope: c.blockingScope,
      issue_type: c.issueType,
      priority: c.priority,
    });
    const classified: ClassifiedClarificationV2 = {
      ...c,
      materiality,
    };

    if (materiality === 'blocking') {
      blocking.push(classified);
    } else {
      nonBlocking.push(classified);
    }
  }

  return { blocking, nonBlocking, discarded };
}

export function computeFinalDecisionFromMateriality(
  result: ClarificationManagerV2Result,
): FinalClarificationDecision {
  return {
    status: result.blocking.length > 0 ? 'needs_clarification' : 'accepted',
    blockingCount: result.blocking.length,
    nonBlockingCount: result.nonBlocking.length,
    discardedCount: result.discarded.length,
  };
}
