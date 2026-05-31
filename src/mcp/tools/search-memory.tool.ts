import { z } from 'zod';
import type { MemorySearchService } from '../../services/memory-search.service.js';

export const searchMemoryInputSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(50).optional().default(10),
});

export async function searchMemory(
  search: MemorySearchService,
  input: z.infer<typeof searchMemoryInputSchema>,
) {
  return search.search(input.query, input.limit);
}
