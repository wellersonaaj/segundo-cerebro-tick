import { z } from 'zod';
import type { MemorySearchService } from '../../services/memory-search.service.js';
import type { EntityType } from '../../types/domain.js';

export const searchEntitiesInputSchema = z.object({
  query: z.string(),
  entity_types: z.array(z.string()).optional().default([]),
  limit: z.number().int().positive().max(50).optional().default(5),
});

export async function searchEntities(
  search: MemorySearchService,
  input: z.infer<typeof searchEntitiesInputSchema>,
) {
  const entityTypes = (input.entity_types ?? []) as EntityType[];
  const matches = await search.searchEntities(input.query, entityTypes, input.limit);
  return {
    matches: matches.map((m) => ({
      entity_id: m.id,
      name: m.name,
      entity_type: m.entity_type,
      match_type: m.match_type,
      confidence: m.confidence,
    })),
  };
}
