import { describe, expect, it, vi } from 'vitest';
import { EntitiesRepository } from '../src/repositories/entities.repository.js';
import { EntityResolutionRepository } from '../src/repositories/entity-resolution.repository.js';
import { MemoryResolverService } from '../src/services/memory-resolver.service.js';
import type { Entity } from '../src/types/domain.js';

function mockEntity(overrides: Partial<Entity>): Entity {
  return {
    id: overrides.id ?? 'e-genius',
    name: overrides.name ?? 'Genius Hotels',
    entity_type: overrides.entity_type ?? 'company',
    normalized_name: overrides.normalized_name ?? 'genius hotels',
    status: 'active',
    superseded_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('MemoryResolverService', () => {
  it('resolves Genius to Genius Hotels via exact alias', async () => {
    const genius = mockEntity({ id: 'e1', name: 'Genius Hotels', normalized_name: 'genius hotels' });

    const entitiesRepo = {
      findByNormalizedName: vi.fn(async (n: string) => (n === 'genius' ? null : null)),
      findByAlias: vi.fn(async (n: string) => (n === 'genius' ? genius : null)),
      searchPartial: vi.fn(async () => []),
      searchByAliasPartial: vi.fn(async () => []),
    } as unknown as EntitiesRepository;

    const resolutionRepo = {
      log: vi.fn(async () => ({})),
      searchRecentMentions: vi.fn(async () => []),
    } as unknown as EntityResolutionRepository;

    const resolver = new MemoryResolverService(entitiesRepo, resolutionRepo);
    const result = await resolver.resolveEntities(
      'inbox-1',
      [{ name: 'Genius', entity_type: 'other', aliases: [], source_excerpt: 'Genius', confidence: 0.7 }],
      'Conversei com o Bruno sobre a Genius.',
    );

    expect(result.resolutions[0]?.status).toBe('resolved');
    expect(result.resolutions[0]?.resolvedEntityName).toBe('Genius Hotels');
    expect(result.byExtractedName.get('genius')).toBe('e1');
  });

  it('removes ambiguous_entity_type clarification when entity resolved', () => {
    const resolver = new MemoryResolverService({} as EntitiesRepository, {} as EntityResolutionRepository);
    const map = {
      byExtractedName: new Map([['genius', 'e1']]),
      resolutions: [
        {
          extractedName: 'Genius',
          status: 'resolved' as const,
          resolvedEntityId: 'e1',
          resolvedEntityName: 'Genius Hotels',
          method: 'exact_alias',
          confidence: 0.95,
          evidence: {},
          candidates: [],
        },
      ],
    };

    const { remaining, autoResolvedIndices } = resolver.filterClarifications(
      [
        {
          target_type: 'entity',
          target_reference: 'Genius',
          issue_type: 'ambiguous_entity_type',
          question: 'Qual tipo da Genius?',
          reason: 'test',
          priority: 'medium',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: [],
          source_excerpt: 'Genius',
        },
        {
          target_type: 'task',
          target_reference: 'Cobrar o fornecedor',
          issue_type: 'missing_task_target',
          question: 'Qual fornecedor deve ser cobrado?',
          reason: 'test',
          priority: 'medium',
          blocking_scope: 'task_execution',
          suggested_answers: [],
          source_excerpt: 'cobrar',
        },
      ],
      map,
      map.resolutions,
    );

    expect(autoResolvedIndices).toHaveLength(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.question).toContain('fornecedor');
  });

  it('marks ambiguous when multiple exact candidates', async () => {
    const e1 = mockEntity({ id: 'e1', name: 'Genius Hotels' });
    const e2 = mockEntity({ id: 'e2', name: 'Genius Labs' });

    const entitiesRepo = {
      findByNormalizedName: vi.fn(async () => e1),
      findByAlias: vi.fn(async () => e2),
      searchPartial: vi.fn(async () => []),
      searchByAliasPartial: vi.fn(async () => []),
    } as unknown as EntitiesRepository;

    const resolutionRepo = {
      log: vi.fn(async () => ({})),
      searchRecentMentions: vi.fn(async () => []),
    } as unknown as EntityResolutionRepository;

    const resolver = new MemoryResolverService(entitiesRepo, resolutionRepo);
    const { resolutions } = await resolver.resolveEntities(
      'inbox-2',
      [{ name: 'Genius', entity_type: 'other', aliases: [], source_excerpt: 'x', confidence: 0.5 }],
      'Genius',
    );
    expect(resolutions[0]?.status).toBe('ambiguous_multiple_matches');
  });
});
