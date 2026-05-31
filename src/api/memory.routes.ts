import type { FastifyInstance } from 'fastify';
import type { MemorySearchService } from '../services/memory-search.service.js';

export async function registerMemoryRoutes(
  app: FastifyInstance,
  search: MemorySearchService,
): Promise<void> {
  app.get('/memory/search', async (req, reply) => {
    const q = (req.query as { q?: string }).q;
    if (!q?.trim()) {
      return reply.status(400).send({ error: 'Query parameter q is required' });
    }
    const limit = Number((req.query as { limit?: string }).limit ?? 10);
    const result = await search.search(q, limit);
    return result;
  });
}
