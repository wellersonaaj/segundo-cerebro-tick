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

  async ensureCorrectionAssertionsCurrent(
    extractionRunId: string,
    correctionId: string,
  ): Promise<void> {
    const { error: linkErr } = await this.db
      .from('assertions')
      .update({ correction_id: correctionId })
      .eq('extraction_run_id', extractionRunId)
      .is('correction_id', null);
    if (linkErr) {
      throw new Error(`assertions_v2.ensureCorrectionAssertionsCurrent link: ${linkErr.message}`);
    }

    const { data: incoming, error: fetchErr } = await this.db
      .from('assertions')
      .select('id, subject_entity_id, predicate')
      .eq('extraction_run_id', extractionRunId)
      .eq('record_status', 'active')
      .eq('assertion_kind', 'status_update')
      .not('subject_entity_id', 'is', null);
    if (fetchErr) {
      throw new Error(`assertions_v2.ensureCorrectionAssertionsCurrent fetch: ${fetchErr.message}`);
    }

    for (const row of incoming ?? []) {
      const { error: clearErr } = await this.db
        .from('assertions')
        .update({ is_current: false })
        .eq('assertion_kind', 'status_update')
        .eq('record_status', 'active')
        .eq('is_current', true)
        .eq('subject_entity_id', row.subject_entity_id)
        .eq('predicate', row.predicate)
        .neq('id', row.id);
      if (clearErr) {
        throw new Error(`assertions_v2.ensureCorrectionAssertionsCurrent clear: ${clearErr.message}`);
      }
    }

    const { error: currentErr } = await this.db
      .from('assertions')
      .update({ is_current: true })
      .eq('extraction_run_id', extractionRunId)
      .eq('record_status', 'active')
      .eq('assertion_kind', 'status_update')
      .not('subject_entity_id', 'is', null)
      .eq('is_current', false);
    if (currentErr) {
      throw new Error(`assertions_v2.ensureCorrectionAssertionsCurrent set: ${currentErr.message}`);
    }
  }
}
