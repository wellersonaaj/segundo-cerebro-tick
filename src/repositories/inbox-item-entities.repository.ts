import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboxItemEntity, InboxItemEntityRelationType } from '../types/domain.js';

export interface CreateInboxItemEntityInput {
  inboxItemId: string;
  extractionRunId: string;
  entityId: string;
  relationType?: InboxItemEntityRelationType;
  sourceExcerpt: string;
  confidence?: number | null;
  correctionId?: string | null;
}

export class InboxItemEntitiesRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(input: CreateInboxItemEntityInput): Promise<InboxItemEntity> {
    const { data, error } = await this.db
      .from('inbox_item_entities')
      .insert({
        inbox_item_id: input.inboxItemId,
        extraction_run_id: input.extractionRunId,
        entity_id: input.entityId,
        relation_type: input.relationType ?? 'mentioned',
        source_excerpt: input.sourceExcerpt,
        confidence: input.confidence ?? null,
        record_status: 'candidate',
        correction_id: input.correctionId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`inbox_item_entities.createCandidate: ${error.message}`);
    return data as InboxItemEntity;
  }

  async listActiveByInboxItem(inboxItemId: string): Promise<InboxItemEntity[]> {
    const { data, error } = await this.db
      .from('inbox_item_entities')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active');
    if (error) throw new Error(`inbox_item_entities.listActiveByInboxItem: ${error.message}`);
    return (data ?? []) as InboxItemEntity[];
  }

  async listActiveByEntity(entityId: string): Promise<InboxItemEntity[]> {
    const { data, error } = await this.db
      .from('inbox_item_entities')
      .select()
      .eq('entity_id', entityId)
      .eq('record_status', 'active');
    if (error) throw new Error(`inbox_item_entities.listActiveByEntity: ${error.message}`);
    return (data ?? []) as InboxItemEntity[];
  }
}
