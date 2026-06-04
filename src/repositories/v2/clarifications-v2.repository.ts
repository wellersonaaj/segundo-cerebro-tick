import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassifiedClarificationV2 } from '../../types/clarification-types.js';
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
    const rows = items.map((c) => ({
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
      materiality: c.materiality,
      suggested_answers: c.suggestedAnswers,
      source_excerpt: c.sourceExcerpt,
      source_block_reference: null,
      status: 'pending' as const,
      record_status: 'candidate' as const,
      correction_id: correctionId ?? null,
    }));
    const { data, error } = await this.db.from('clarification_requests').insert(rows).select('id');
    if (error) throw new Error(`clarifications_v2.createManyCandidates: ${error.message}`);
    return (data ?? []) as Array<{ id: string }>;
  }
}
