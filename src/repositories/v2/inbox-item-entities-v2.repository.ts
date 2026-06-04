import type { SupabaseClient } from '@supabase/supabase-js';

export class InboxItemEntitiesV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(input: {
    inboxItemId: string;
    extractionRunId: string;
    entityId: string;
    relationType?: string;
    sourceExcerpt: string;
    sourceBlockReference?: string | null;
    confidence?: number | null;
    correctionId?: string;
  }): Promise<void> {
    const { error } = await this.db.from('inbox_item_entities').insert({
      inbox_item_id: input.inboxItemId,
      extraction_run_id: input.extractionRunId,
      entity_id: input.entityId,
      relation_type: input.relationType ?? 'mentioned',
      source_excerpt: input.sourceExcerpt,
      source_block_reference: input.sourceBlockReference ?? null,
      confidence: input.confidence ?? null,
      correction_id: input.correctionId ?? null,
      record_status: 'candidate',
    });
    if (error && !error.message.includes('duplicate') && error.code !== '23505') {
      throw new Error(`inbox_item_entities_v2.createCandidate: ${error.message}`);
    }
  }
}
