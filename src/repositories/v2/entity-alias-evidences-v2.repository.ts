import type { SupabaseClient } from '@supabase/supabase-js';

export class EntityAliasEvidencesV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(input: {
    entityAliasId: string;
    inboxItemId: string;
    extractionRunId: string;
    sourceExcerpt: string;
    sourceBlockReference?: string | null;
    confidence?: number | null;
    negated?: boolean;
  }): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('entity_alias_evidences')
      .insert({
        entity_alias_id: input.entityAliasId,
        inbox_item_id: input.inboxItemId,
        extraction_run_id: input.extractionRunId,
        source_excerpt: input.sourceExcerpt,
        source_block_reference: input.sourceBlockReference ?? null,
        confidence: input.confidence ?? null,
        negated: input.negated ?? false,
        record_status: 'candidate',
      })
      .select('id')
      .single();
    if (error && !error.message.includes('duplicate') && error.code !== '23505') {
      throw new Error(`entity_alias_evidences_v2.createCandidate: ${error.message}`);
    }
    if (error) {
      const { data: existing } = await this.db
        .from('entity_alias_evidences')
        .select('id')
        .eq('entity_alias_id', input.entityAliasId)
        .eq('extraction_run_id', input.extractionRunId)
        .eq('source_excerpt', input.sourceExcerpt)
        .maybeSingle();
      if (!existing) throw new Error(`entity_alias_evidences_v2.createCandidate: ${error.message}`);
      return existing as { id: string };
    }
    return data as { id: string };
  }
}
