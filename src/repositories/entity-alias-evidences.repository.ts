import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityAliasEvidence } from '../types/domain.js';

export interface CreateAliasEvidenceInput {
  entityAliasId: string;
  inboxItemId: string;
  extractionRunId: string;
  sourceExcerpt: string;
  confidence?: number | null;
}

export class EntityAliasEvidencesRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(input: CreateAliasEvidenceInput): Promise<EntityAliasEvidence> {
    const { data, error } = await this.db
      .from('entity_alias_evidences')
      .insert({
        entity_alias_id: input.entityAliasId,
        inbox_item_id: input.inboxItemId,
        extraction_run_id: input.extractionRunId,
        source_excerpt: input.sourceExcerpt,
        confidence: input.confidence ?? null,
        record_status: 'candidate',
      })
      .select()
      .single();
    if (error && !error.message.includes('duplicate') && error.code !== '23505') {
      throw new Error(`entity_alias_evidences.createCandidate: ${error.message}`);
    }
    if (error) {
      const { data: existing, error: fetchErr } = await this.db
        .from('entity_alias_evidences')
        .select()
        .eq('entity_alias_id', input.entityAliasId)
        .eq('extraction_run_id', input.extractionRunId)
        .eq('source_excerpt', input.sourceExcerpt)
        .maybeSingle();
      if (fetchErr) throw new Error(`entity_alias_evidences.createCandidate: ${fetchErr.message}`);
      if (!existing) throw new Error(`entity_alias_evidences.createCandidate: ${error.message}`);
      return existing as EntityAliasEvidence;
    }
    return data as EntityAliasEvidence;
  }
}
