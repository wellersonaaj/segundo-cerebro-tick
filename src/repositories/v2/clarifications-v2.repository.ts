import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassifiedClarificationV2 } from '../../types/clarification-types.js';
import { materialityFromFields } from '../../types/clarification-types.js';
import { normalizeText } from '../../utils/normalize.js';

export class ClarificationsV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async createManyCandidates(
    inboxItemId: string,
    extractionRunId: string,
    items: ClassifiedClarificationV2[],
    correctionId?: string,
  ): Promise<Array<{ id: string }>> {
    if (!items.length) return [];
    const rows = items.map((c) => {
      // ClassifiedClarificationV2.materiality is required, but be defensive
      // (the type may be widened in some compile paths). Coerce any non-valid
      // value to the derived field; fall back to 'non_blocking' as the
      // safest default — never null, never violates the DB NOT NULL.
      const validMateriality: 'blocking' | 'non_blocking' =
        c.materiality === 'blocking' || c.materiality === 'non_blocking'
          ? c.materiality
          : materialityFromFields({
              blocking_scope: c.blockingScope ?? 'none',
              issue_type: c.issueType ?? 'other',
              priority: c.priority ?? 'medium',
            });
      return {
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        target_type: c.targetType,
        target_reference: c.targetReference,
        normalized_target_reference: normalizeText(c.targetReference),
        issue_type: c.issueType,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        blocking_scope: c.blockingScope,
        materiality: validMateriality,
        suggested_answers: c.suggestedAnswers,
        source_excerpt: c.sourceExcerpt,
        source_block_reference: null,
        status: 'pending' as const,
        record_status: 'candidate' as const,
        correction_id: correctionId ?? null,
      };
    });
    const { data, error } = await this.db.from('clarification_requests').insert(rows).select('id');
    if (error) throw new Error(`clarifications_v2.createManyCandidates: ${error.message}`);
    return (data ?? []) as Array<{ id: string }>;
  }
}
