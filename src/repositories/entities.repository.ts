import type { SupabaseClient } from '@supabase/supabase-js';
import type { Entity, EntityAlias, EntityType } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';

export class EntitiesRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findByNormalizedName(normalized: string): Promise<Entity | null> {
    const { data, error } = await this.db
      .from('entities')
      .select()
      .eq('normalized_name', normalized)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new Error(`entities.findByNormalizedName: ${error.message}`);
    return data as Entity | null;
  }

  async findByAlias(normalizedAlias: string): Promise<Entity | null> {
    const { data: aliasRow, error: aliasErr } = await this.db
      .from('entity_aliases')
      .select('entity_id')
      .eq('normalized_alias', normalizedAlias)
      .maybeSingle();
    if (aliasErr) throw new Error(`entities.findByAlias: ${aliasErr.message}`);
    if (!aliasRow) return null;
    return this.findById(aliasRow.entity_id as string);
  }

  async findById(id: string): Promise<Entity | null> {
    const { data, error } = await this.db.from('entities').select().eq('id', id).maybeSingle();
    if (error) throw new Error(`entities.findById: ${error.message}`);
    return data as Entity | null;
  }

  async searchPartial(normalized: string, limit = 10): Promise<Entity[]> {
    const { data, error } = await this.db
      .from('entities')
      .select()
      .eq('status', 'active')
      .ilike('normalized_name', `%${normalized}%`)
      .limit(limit);
    if (error) throw new Error(`entities.searchPartial: ${error.message}`);
    return (data ?? []) as Entity[];
  }

  async searchByAliasPartial(normalized: string, limit = 10): Promise<Entity[]> {
    const { data: aliases, error } = await this.db
      .from('entity_aliases')
      .select('entity_id, entities(*)')
      .ilike('normalized_alias', `%${normalized}%`)
      .limit(limit);
    if (error) throw new Error(`entities.searchByAliasPartial: ${error.message}`);
    const entities: Entity[] = [];
    for (const row of aliases ?? []) {
      const ent = (row as unknown as { entities: Entity | null }).entities;
      if (ent && ent.status === 'active') entities.push(ent);
    }
    return entities;
  }

  async list(entityTypes?: EntityType[], limit = 50): Promise<Entity[]> {
    let q = this.db.from('entities').select().eq('status', 'active').order('name').limit(limit);
    if (entityTypes?.length) q = q.in('entity_type', entityTypes);
    const { data, error } = await q;
    if (error) throw new Error(`entities.list: ${error.message}`);
    return (data ?? []) as Entity[];
  }

  async create(name: string, entityType: EntityType): Promise<Entity> {
    const normalized_name = normalizeText(name);
    const { data, error } = await this.db
      .from('entities')
      .insert({ name, canonical_name: name, entity_type: entityType, normalized_name })
      .select()
      .single();
    if (error) throw new Error(`entities.create: ${error.message}`);
    return data as Entity;
  }

  async getAliases(entityId: string): Promise<EntityAlias[]> {
    const { data, error } = await this.db
      .from('entity_aliases')
      .select()
      .eq('entity_id', entityId);
    if (error) throw new Error(`entities.getAliases: ${error.message}`);
    return (data ?? []) as EntityAlias[];
  }

  async addAlias(entityId: string, alias: string): Promise<EntityAlias> {
    const normalized_alias = normalizeText(alias);
    const { data, error } = await this.db
      .from('entity_aliases')
      .insert({
        entity_id: entityId,
        alias,
        normalized_alias,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(`entities.addAlias: ${error.message}`);
    return data as EntityAlias;
  }

  async searchEntitiesQuery(
    query: string,
    entityTypes: EntityType[] = [],
    limit = 5,
  ): Promise<Array<Entity & { match_type: string; confidence: number }>> {
    const normalized = normalizeText(query);
    const matches: Array<Entity & { match_type: string; confidence: number }> = [];
    const seen = new Set<string>();

    const exact = await this.findByNormalizedName(normalized);
    if (exact && !seen.has(exact.id)) {
      matches.push({ ...exact, match_type: 'exact_name', confidence: 0.98 });
      seen.add(exact.id);
    }

    const aliasExact = await this.findByAlias(normalized);
    if (aliasExact && !seen.has(aliasExact.id)) {
      matches.push({ ...aliasExact, match_type: 'exact_alias', confidence: 0.95 });
      seen.add(aliasExact.id);
    }

    for (const e of await this.searchPartial(normalized, limit)) {
      if (!seen.has(e.id) && (!entityTypes.length || entityTypes.includes(e.entity_type))) {
        matches.push({ ...e, match_type: 'partial_name', confidence: 0.7 });
        seen.add(e.id);
      }
    }

    for (const e of await this.searchByAliasPartial(normalized, limit)) {
      if (!seen.has(e.id) && (!entityTypes.length || entityTypes.includes(e.entity_type))) {
        matches.push({ ...e, match_type: 'partial_alias', confidence: 0.65 });
        seen.add(e.id);
      }
    }

    return matches.slice(0, limit);
  }
}
