import { z } from 'zod';
import type { MemorySearchService } from '../../services/memory-search.service.js';

export const listOpenTasksInputSchema = z.object({
  query: z.string().optional().default(''),
  limit: z.number().int().positive().max(50).optional().default(10),
});

export async function listOpenTasks(
  search: MemorySearchService,
  input: z.infer<typeof listOpenTasksInputSchema>,
) {
  const tasks = await search.listOpenTasks(input.query || undefined, input.limit);
  return { tasks };
}
