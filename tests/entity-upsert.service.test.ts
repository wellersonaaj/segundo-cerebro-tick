import { describe, expect, it, vi } from 'vitest';
import type { EntitiesRepository } from '../src/repositories/entities.repository.js';
import type { EntityAliasEvidencesRepository } from '../src/repositories/entity-alias-evidences.repository.js';
import { EntityUpsertService } from '../src/services/entity-upsert.service.js';
import type { Entity, EntityAlias, ExtractedEntity } from '../src/types/domain.js';

function mockEntity(overrides: Partial<Entity>): Entity {
  return {
    id: overrides.id ?? 'e1',
    name: overrides.name ?? 'Larisse do Carmo Peixoto',
    entity_type: overrides.entity_type ?? 'person',
    normalized_name: overrides.normalized_name ?? 'larisse do carmo peixoto',
    status: 'active',
    registry_status: overrides.registry_status ?? 'active',
    created_by_extraction_run_id: null,
    superseded_by: null,
    created_at: '',
    updated_at: '',
  };
}

function mockAlias(overrides: Partial<EntityAlias>): EntityAlias {
  return {
    id: overrides.id ?? 'a1',
    entity_id: overrides.entity_id ?? 'e1',
    alias: overrides.alias ?? 'Lari',
    normalized_alias: overrides.normalized_alias ?? 'lari',
    registry_status: overrides.registry_status ?? 'active',
    created_by_extraction_run_id: null,
    created_at: '',
  };
}

function extracted(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    name: 'Larisse do Carmo Peixoto',
    entity_type: 'person',
    aliases: ['Lari'],
    source_excerpt: 'Larisse do Carmo Peixoto, alias Lari',
    confidence: 0.9,
    ...overrides,
  };
}

function mockEvidencesRepo(): EntityAliasEvidencesRepository {
  return {
    createCandidate: vi.fn(async () => ({
      id: 'ev1',
      entity_alias_id: 'a1',
      inbox_item_id: 'inbox-1',
      extraction_run_id: 'run-1',
      source_excerpt: '',
      confidence: null,
      record_status: 'candidate',
      created_at: '',
    })),
  } as unknown as EntityAliasEvidencesRepository;
}

describe('EntityUpsertService', () => {
  it('creates entity candidate and persists alias with evidence', async () => {
    const created = mockEntity({ id: 'e-new', registry_status: 'candidate' });
    const alias = mockAlias({ id: 'a-new', entity_id: 'e-new' });
    const repo = {
      findById: vi.fn(async () => null),
      findByNormalizedNameActive: vi.fn(async () => null),
      findByNormalizedNameCandidate: vi.fn(async () => null),
      createCandidate: vi.fn(async () => created),
      findAliasOwnerAny: vi.fn(async () => null),
      findAliasByEntityAndNormalized: vi.fn(async () => null),
      createAliasCandidate: vi.fn(async () => alias),
    } as unknown as EntitiesRepository;
    const evidences = mockEvidencesRepo();

    const service = new EntityUpsertService(repo, evidences);
    const result = await service.upsert({
      inboxItemId: 'inbox-1',
      extractionRunId: 'run-1',
      extractedEntity: extracted(),
    });

    expect(result.resolutionStatus).toBe('created');
    expect(result.aliasesPersisted).toEqual(['Lari']);
    expect(repo.createAliasCandidate).toHaveBeenCalledWith('e-new', 'Lari', 'run-1');
    expect(evidences.createCandidate).toHaveBeenCalled();
  });

  it('reuses active entity from resolver hint', async () => {
    const existing = mockEntity({ id: 'e-existing', name: 'Bruno Brant Gotschalg' });
    const alias = mockAlias({ id: 'a-bruno', entity_id: 'e-existing', alias: 'Bruno' });
    const repo = {
      findById: vi.fn(async () => existing),
      findAliasOwnerAny: vi.fn(async () => null),
      findAliasByEntityAndNormalized: vi.fn(async () => null),
      createAliasCandidate: vi.fn(async () => alias),
    } as unknown as EntitiesRepository;
    const evidences = mockEvidencesRepo();

    const service = new EntityUpsertService(repo, evidences);
    const result = await service.upsert({
      inboxItemId: 'inbox-1',
      extractionRunId: 'run-1',
      extractedEntity: extracted({
        name: 'Bruno Brant Gotschalg',
        aliases: ['Bruno', 'Brant'],
      }),
      resolvedEntityId: 'e-existing',
    });

    expect(result.resolutionStatus).toBe('reused_from_resolver');
    expect(result.aliasesPersisted).toEqual(['Bruno', 'Brant']);
  });

  it('reuses orphan candidate entity from failed run', async () => {
    const orphan = mockEntity({ id: 'e-orphan', registry_status: 'candidate' });
    const repo = {
      findById: vi.fn(),
      findByNormalizedNameActive: vi.fn(async () => null),
      findByNormalizedNameCandidate: vi.fn(async () => orphan),
      findAliasOwnerAny: vi.fn(async () => null),
    } as unknown as EntitiesRepository;

    const service = new EntityUpsertService(repo, mockEvidencesRepo());
    const result = await service.upsert({
      inboxItemId: 'inbox-1',
      extractionRunId: 'run-2',
      extractedEntity: extracted({ aliases: [] }),
    });

    expect(result.resolutionStatus).toBe('reused_candidate');
    expect(result.entityId).toBe('e-orphan');
  });

  it('records conflict when alias belongs to another entity', async () => {
    const target = mockEntity({ id: 'e-target', name: 'Bruno Brant Gotschalg' });
    const repo = {
      findById: vi.fn(),
      findByNormalizedNameActive: vi.fn(async () => target),
      findByNormalizedNameCandidate: vi.fn(async () => null),
      findAliasOwnerAny: vi.fn(async (normalized: string) =>
        normalized === 'bruno'
          ? {
              entityId: 'e-other',
              entityName: 'Bruno Ramos',
              aliasId: 'a-other',
              registryStatus: 'active',
            }
          : null,
      ),
    } as unknown as EntitiesRepository;

    const service = new EntityUpsertService(repo, mockEvidencesRepo());
    const result = await service.upsert({
      inboxItemId: 'inbox-1',
      extractionRunId: 'run-1',
      extractedEntity: extracted({
        name: 'Bruno Brant Gotschalg',
        aliases: ['Bruno'],
      }),
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.aliasClarifications[0]?.issue_type).toBe('ambiguous_alias_conflict');
  });
});
