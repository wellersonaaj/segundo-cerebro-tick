import { describe, expect, it, vi } from 'vitest';
import { MemorySearchService } from '../src/services/memory-search.service.js';

describe('MemorySearchService alias hydration', () => {
  it('hydrates aliases on search results from entity_aliases', async () => {
    const entitiesRepo = {
      searchEntitiesQuery: vi.fn(async () => [
        {
          id: 'e1',
          name: 'Wellerson Assumpção',
          entity_type: 'person',
          normalized_name: 'wellerson assumpcao',
          status: 'active',
          superseded_by: null,
          created_at: '',
          updated_at: '',
          match_type: 'exact_alias',
          confidence: 0.95,
        },
      ]),
      getAliases: vi.fn(async () => [
        {
          id: 'a1',
          entity_id: 'e1',
          alias: 'Tick',
          normalized_alias: 'tick',
          created_at: '',
        },
        {
          id: 'a2',
          entity_id: 'e1',
          alias: 'Wellerson',
          normalized_alias: 'wellerson',
          created_at: '',
        },
      ]),
    };

    const service = new MemorySearchService(
      entitiesRepo as never,
      { searchText: vi.fn(async () => []) } as never,
      { searchText: vi.fn(async () => []) } as never,
      { listOpen: vi.fn(async () => []) } as never,
      { searchRecentMentions: vi.fn(async () => []) } as never,
      { listActiveByEntity: vi.fn(async () => []) } as never,
    );

    const result = await service.search('Tick');
    expect(result.entities[0]?.aliases).toEqual(['Tick', 'Wellerson']);
    expect(entitiesRepo.getAliases).toHaveBeenCalledWith('e1');
  });

  it('getEntityDetails returns alias strings from entity_aliases', async () => {
    const entitiesRepo = {
      findById: vi.fn(async () => ({
        id: 'e1',
        name: 'Wellerson Assumpção',
        entity_type: 'person',
        normalized_name: 'wellerson assumpcao',
        status: 'active',
        registry_status: 'active',
        created_by_extraction_run_id: null,
        superseded_by: null,
        created_at: '',
        updated_at: '',
      })),
      getAliases: vi.fn(async () => [
        {
          id: 'a1',
          entity_id: 'e1',
          alias: 'Tick',
          normalized_alias: 'tick',
          registry_status: 'active',
          created_by_extraction_run_id: null,
          created_at: '',
        },
      ]),
    };

    const service = new MemorySearchService(
      entitiesRepo as never,
      { listByEntity: vi.fn(async () => []) } as never,
      {} as never,
      { listOpen: vi.fn(async () => []) } as never,
      {} as never,
      { listActiveByEntity: vi.fn(async () => []) } as never,
    );

    const details = await service.getEntityDetails('e1');
    expect(details?.aliases).toEqual(['Tick']);
  });
});
