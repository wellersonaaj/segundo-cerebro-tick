import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType } from '../../types/domain.js';
import { normalizeText } from '../../utils/normalize.js';

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate');
}

export interface EntityV2Row {
  id: string;
  name: string;
  canonical_name: string;
  entity_type: EntityType;
  normalized_name: string;
  registry_status: string;
}

export class EntitiesV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async findById(id: string): Promise<EntityV2Row | null> {
    const { data, error } = await this.db.from('entities').select().eq('id', id).maybeSingle();
    if (error) throw new Error(`entities_v2.findById: ${error.message}`);
    return data as EntityV2Row | null;
  }

  async findByNormalizedNameActive(normalized: string): Promise<EntityV2Row | null> {
    const { data, error } = await this.db
      .from('entities')
      .select()
      .eq('normalized_name', normalized)
      .eq('registry_status', 'active')
      .maybeSingle();
    if (error) throw new Error(`entities_v2.findByNormalizedNameActive: ${error.message}`);
    return data as EntityV2Row | null;
  }

  async findByNormalizedNameCandidate(normalized: string): Promise<EntityV2Row | null> {
    const { data, error } = await this.db
      .from('entities')
      .select()
      .eq('normalized_name', normalized)
      .eq('registry_status', 'candidate')
      .maybeSingle();
    if (error) throw new Error(`entities_v2.findByNormalizedNameCandidate: ${error.message}`);
    return data as EntityV2Row | null;
  }

  async createCandidate(
    name: string,
    entityType: EntityType,
    extractionRunId: string,
  ): Promise<EntityV2Row> {
    const normalized_name = normalizeText(name);
    const { data, error } = await this.db
      .from('entities')
      .insert({
        name,
        canonical_name: name,
        entity_type: entityType,
        normalized_name,
        registry_status: 'candidate',
        created_by_extraction_run_id: extractionRunId,
      })
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const existing =
          (await this.findByNormalizedNameActive(normalized_name)) ??
          (await this.findByNormalizedNameCandidate(normalized_name));
        if (existing) return existing;
      }
      throw new Error(`entities_v2.createCandidate: ${error.message}`);
    }
    return data as EntityV2Row;
  }

  async createAliasCandidate(
    entityId: string,
    alias: string,
    extractionRunId: string,
  ): Promise<{ id: string; normalized_alias: string }> {
    const normalized_alias = normalizeText(alias);
    const { data, error } = await this.db
      .from('entity_aliases')
      .insert({
        entity_id: entityId,
        alias,
        normalized_alias,
        registry_status: 'candidate',
        created_by_extraction_run_id: extractionRunId,
      })
      .select('id, normalized_alias')
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: existing } = await this.db
          .from('entity_aliases')
          .select('id, normalized_alias')
          .eq('normalized_alias', normalized_alias)
          .in('registry_status', ['active', 'candidate'])
          .maybeSingle();
        if (existing) return existing as { id: string; normalized_alias: string };
      }
      throw new Error(`entities_v2.createAliasCandidate: ${error.message}`);
    }
    return data as { id: string; normalized_alias: string };
  }
}
