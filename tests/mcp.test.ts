import { describe, expect, it, vi } from 'vitest';
import { getEntityDetails } from '../src/mcp/tools/get-entity-details.tool.js';
import { searchEntities } from '../src/mcp/tools/search-entities.tool.js';
import { listOpenTasks } from '../src/mcp/tools/list-open-tasks.tool.js';
import type { MemorySearchService } from '../src/services/memory-search.service.js';

describe('MCP tools', () => {
  it('search_entities returns formatted matches', async () => {
    const search = {
      searchEntities: vi.fn(async () => [
        {
          id: 'uuid-1',
          name: 'Genius Hotels',
          entity_type: 'company',
          normalized_name: 'genius hotels',
          status: 'active',
          superseded_by: null,
          created_at: '',
          updated_at: '',
          match_type: 'exact_alias',
          confidence: 0.95,
        },
      ]),
    } as unknown as MemorySearchService;

    const result = await searchEntities(search, { query: 'Genius', entity_types: [], limit: 5 });
    expect(result.matches[0]).toEqual({
      entity_id: 'uuid-1',
      name: 'Genius Hotels',
      entity_type: 'company',
      match_type: 'exact_alias',
      confidence: 0.95,
    });
  });

  it('get_entity_details returns alias strings', async () => {
    const search = {
      getEntityDetails: vi.fn(async () => ({
        entity: {
          id: 'e1',
          name: 'Genius Hotels',
          entity_type: 'company',
          normalized_name: 'genius hotels',
          status: 'active',
          superseded_by: null,
          created_at: '',
          updated_at: '',
        },
        aliases: [
          {
            id: 'a1',
            entity_id: 'e1',
            alias: 'Genius',
            normalized_alias: 'genius',
            created_at: '',
          },
        ],
        events: [],
        open_tasks: [],
      })),
    } as unknown as MemorySearchService;

    const result = await getEntityDetails(search, { entity_id: 'e1' });
    expect(result.aliases).toEqual(['Genius']);
  });

  it('list_open_tasks returns tasks', async () => {
    const search = {
      listOpenTasks: vi.fn(async () => [{ id: 't1', title: 'Cobrar fornecedor', status: 'open' }]),
    } as unknown as MemorySearchService;

    const result = await listOpenTasks(search, { query: 'fornecedor', limit: 10 });
    expect(result.tasks).toHaveLength(1);
  });
});
