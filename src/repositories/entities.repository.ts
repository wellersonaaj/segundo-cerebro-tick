import type { SupabaseClient } from '@supabase/supabase-js';
import type { Entity, EntityAlias, EntityType } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate');
}

export class EntitiesRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findByNormalizedNameActive(normalized: string): Promise<Entity | null> {
    const { data, error } = await this.db
      .from('entities')
      .select()
      .eq('normalized_name', normalized)
      .eq('registry_status', 'active')
      .maybeSingle();
    if (error) throw new Error(`entities.findByNormalizedNameActive: ${error.message}`);
    return data as Entity | null;
  }

  async findByNormalizedNameCandidate(normalized: string): Promise<Entity | null> {
    const { data, error } = await this.db
      .from('entities')
      .select()
      .eq('normalized_name', normalized)
      .eq('registry_status', 'candidate')
      .maybeSingle();
    if (error) throw new Error(`entities.findByNormalizedNameCandidate: ${error.message}`);
    return data as Entity | null;
  }

  /** Resolver-visible lookup: active registry only */
  async findByNormalizedName(normalized: string): Promise<Entity | null> {
    return this.findByNormalizedNameActive(normalized);
  }

  async findByAlias(normalizedAlias: string): Promise<Entity | null> {
    const owner = await this.findAliasOwnerActive(normalizedAlias);
    if (!owner) return null;
    return this.findById(owner.entityId);
  }

  async findAliasOwnerActive(
    normalizedAlias: string,
  ): Promise<{ entityId: string; entityName: string; aliasId: string } | null> {
    const { data: aliasRow, error: aliasErr } = await this.db
      .from('entity_aliases')
      .select('id, entity_id, entities(name)')
      .eq('normalized_alias', normalizedAlias)
      .eq('registry_status', 'active')
      .maybeSingle();
    if (aliasErr) throw new Error(`entities.findAliasOwnerActive: ${aliasErr.message}`);
    if (!aliasRow) return null;
    const entityId = aliasRow.entity_id as string;
    const aliasId = aliasRow.id as string;
    const joined = aliasRow as unknown as { entities: { name: string } | { name: string }[] | null };
    const nested = joined.entities;
    const entityName = Array.isArray(nested) ? nested[0]?.name : nested?.name;
    if (!entityName) {
      const entity = await this.findById(entityId);
      if (!entity) return null;
      return { entityId, entityName: entity.name, aliasId };
    }
    return { entityId, entityName, aliasId };
  }

  async findAliasOwnerAny(
    normalizedAlias: string,
  ): Promise<{ entityId: string; entityName: string; aliasId: string; registryStatus: string } | null> {
    const { data: aliasRow, error: aliasErr } = await this.db
      .from('entity_aliases')
      .select('id, entity_id, registry_status, entities(name)')
      .eq('normalized_alias', normalizedAlias)
      .in('registry_status', ['active', 'candidate'])
      .maybeSingle();
    if (aliasErr) throw new Error(`entities.findAliasOwnerAny: ${aliasErr.message}`);
    if (!aliasRow) return null;
    const entityId = aliasRow.entity_id as string;
    const aliasId = aliasRow.id as string;
    const registryStatus = aliasRow.registry_status as string;
    const joined = aliasRow as unknown as { entities: { name: string } | { name: string }[] | null };
    const nested = joined.entities;
    const entityName = Array.isArray(nested) ? nested[0]?.name : nested?.name;
    if (!entityName) {
      const entity = await this.findById(entityId);
      if (!entity) return null;
      return { entityId, entityName: entity.name, aliasId, registryStatus };
    }
    return { entityId, entityName, aliasId, registryStatus };
  }

  /** @deprecated use findAliasOwnerActive */
  async findAliasOwner(
    normalizedAlias: string,
  ): Promise<{ entityId: string; entityName: string } | null> {
    const owner = await this.findAliasOwnerAny(normalizedAlias);
    if (!owner) return null;
    return { entityId: owner.entityId, entityName: owner.entityName };
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
      .eq('registry_status', 'active')
      .ilike('normalized_name', `%${normalized}%`)
      .limit(limit);
    if (error) throw new Error(`entities.searchPartial: ${error.message}`);
    return (data ?? []) as Entity[];
  }

  async searchByAliasPartial(normalized: string, limit = 10): Promise<Entity[]> {
    const { data: aliases, error } = await this.db
      .from('entity_aliases')
      .select('entity_id, entities(*)')
      .eq('registry_status', 'active')
      .ilike('normalized_alias', `%${normalized}%`)
      .limit(limit);
    if (error) throw new Error(`entities.searchByAliasPartial: ${error.message}`);
    const entities: Entity[] = [];
    for (const row of aliases ?? []) {
      const ent = (row as unknown as { entities: Entity | null }).entities;
      if (ent && ent.registry_status === 'active') entities.push(ent);
    }
    return entities;
  }

  async list(entityTypes?: EntityType[], limit = 50): Promise<Entity[]> {
    let q = this.db
      .from('entities')
      .select()
      .eq('registry_status', 'active')
      .order('name')
      .limit(limit);
    if (entityTypes?.length) q = q.in('entity_type', entityTypes);
    const { data, error } = await q;
    if (error) throw new Error(`entities.list: ${error.message}`);
    return (data ?? []) as Entity[];
  }

  async createCandidate(
    name: string,
    entityType: EntityType,
    extractionRunId: string,
  ): Promise<Entity> {
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
      throw new Error(`entities.createCandidate: ${error.message}`);
    }
    return data as Entity;
  }

  /** @deprecated use createCandidate in pipeline */
  async create(name: string, entityType: EntityType): Promise<Entity> {
    const normalized_name = normalizeText(name);
    const { data, error } = await this.db
      .from('entities')
      .insert({
        name,
        canonical_name: name,
        entity_type: entityType,
        normalized_name,
        registry_status: 'active',
      })
      .select()
      .single();
    if (error) throw new Error(`entities.create: ${error.message}`);
    return data as Entity;
  }

  async getAliases(entityId: string): Promise<EntityAlias[]> {
    const { data, error } = await this.db
      .from('entity_aliases')
      .select()
      .eq('entity_id', entityId)
      .eq('registry_status', 'active');
    if (error) throw new Error(`entities.getAliases: ${error.message}`);
    return (data ?? []) as EntityAlias[];
  }

  async findAliasByEntityAndNormalized(
    entityId: string,
    normalizedAlias: string,
  ): Promise<EntityAlias | null> {
    const { data, error } = await this.db
      .from('entity_aliases')
      .select()
      .eq('entity_id', entityId)
      .eq('normalized_alias', normalizedAlias)
      .in('registry_status', ['active', 'candidate'])
      .maybeSingle();
    if (error) throw new Error(`entities.findAliasByEntityAndNormalized: ${error.message}`);
    return data as EntityAlias | null;
  }

  async createAliasCandidate(
    entityId: string,
    alias: string,
    extractionRunId: string,
  ): Promise<EntityAlias> {
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
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const owner = await this.findAliasOwnerAny(normalized_alias);
        if (owner && owner.entityId === entityId) {
          const existing = await this.findAliasByEntityAndNormalized(entityId, normalized_alias);
          if (existing) return existing;
        }
      }
      throw new Error(`entities.createAliasCandidate: ${error.message}`);
    }
    return data as EntityAlias;
  }

  async addAlias(entityId: string, alias: string): Promise<EntityAlias> {
    const normalized_alias = normalizeText(alias);
    const { data, error } = await this.db
      .from('entity_aliases')
      .insert({
        entity_id: entityId,
        alias,
        normalized_alias,
        registry_status: 'active',
      })
      .select()
      .single();
    if (error) throw new Error(`entities.addAlias: ${error.message}`);
    return data as EntityAlias;
  }

  async addAliasIdempotent(entityId: string, alias: string): Promise<'created' | 'exists'> {
    const normalized_alias = normalizeText(alias);
    const owner = await this.findAliasOwnerAny(normalized_alias);
    if (owner) {
      return owner.entityId === entityId ? 'exists' : 'exists';
    }

    const { error } = await this.db.from('entity_aliases').insert({
      entity_id: entityId,
      alias,
      normalized_alias,
      registry_status: 'active',
    });

    if (!error) return 'created';

    if (isUniqueViolation(error)) {
      const retryOwner = await this.findAliasOwnerAny(normalized_alias);
      if (retryOwner?.entityId === entityId) return 'exists';
    }

    throw new Error(`entities.addAliasIdempotent: ${error.message}`);
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
