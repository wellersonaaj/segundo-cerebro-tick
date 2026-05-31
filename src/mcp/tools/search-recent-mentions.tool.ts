import { z } from 'zod';
import type { MemorySearchService } from '../../services/memory-search.service.js';

export const searchRecentMentionsInputSchema = z.object({
  query: z.string(),
  days: z.number().int().positive().max(365).optional().default(90),
  limit: z.number().int().positive().max(50).optional().default(10),
});

export async function searchRecentMentions(
  search: MemorySearchService,
  input: z.infer<typeof searchRecentMentionsInputSchema>,
) {
  const mentions = await search.searchRecentMentions(input.query, input.days, input.limit);
  return { mentions };
}
