import { z } from 'zod';
import type { MemorySearchService } from '../../services/memory-search.service.js';

export const getEntityDetailsInputSchema = z.object({
  entity_id: z.string().uuid(),
});

export async function getEntityDetails(
  search: MemorySearchService,
  input: z.infer<typeof getEntityDetailsInputSchema>,
) {
  const details = await search.getEntityDetails(input.entity_id);
  if (!details) return { error: 'Entity not found' };
  return {
    entity: details.entity,
    aliases: details.aliases.map((a) => a.alias),
    recent_events: details.events,
    open_tasks: details.open_tasks,
  };
}
