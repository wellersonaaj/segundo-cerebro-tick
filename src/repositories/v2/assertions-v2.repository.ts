import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompiledAssertionV2 } from '../../types/memory-compiler-v2.js';

export class AssertionsV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(
    inboxItemId: string,
    extractionRunId: string,
    assertion: CompiledAssertionV2,
    correctionId?: string,
  ): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('assertions')
      .insert({
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        assertion_kind: assertion.assertionKind,
        subject_reference: assertion.subjectReference,
        subject_entity_id: assertion.subjectEntityId,
        predicate: assertion.predicate,
        object_reference: assertion.objectReference,
        value_text: assertion.valueText,
        source_excerpt: assertion.sourceExcerpt,
        source_block_reference: assertion.sourceBlockReference,
        confidence: assertion.confidence,
        is_current: assertion.assertionKind === 'status_update' && assertion.subjectEntityId != null,
        correction_id: correctionId ?? null,
        record_status: 'candidate',
      })
      .select('id')
      .single();
    if (error) throw new Error(`assertions_v2.createCandidate: ${error.message}`);
    return data as { id: string };
  }

  async linkEntity(
    assertionId: string,
    opts: {
      entityId?: string | null;
      entityReference: string;
      referenceRole: 'subject' | 'object' | 'related';
      resolutionStatus: string;
    },
  ): Promise<void> {
    const { error } = await this.db.from('assertion_entities').insert({
      assertion_id: assertionId,
      entity_id: opts.entityId ?? null,
      entity_reference: opts.entityReference,
      reference_role: opts.referenceRole,
      resolution_status: opts.resolutionStatus,
    });
    if (error) throw new Error(`assertions_v2.linkEntity: ${error.message}`);
  }
}
