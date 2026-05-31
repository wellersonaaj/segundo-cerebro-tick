import type { FastifyInstance } from 'fastify';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import type { MemorySearchService } from '../services/memory-search.service.js';

export async function registerEntitiesRoutes(
  app: FastifyInstance,
  entitiesRepo: EntitiesRepository,
  eventsRepo: EventsRepository,
  search: MemorySearchService,
): Promise<void> {
  app.get('/entities', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    return entitiesRepo.list(undefined, limit);
  });

  app.get('/entities/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const details = await search.getEntityDetails(id);
    if (!details) return reply.status(404).send({ error: 'Not found' });
    return details;
  });

  app.get('/entities/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const entity = await entitiesRepo.findById(id);
    if (!entity) return reply.status(404).send({ error: 'Not found' });
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return eventsRepo.listByEntity(id, limit);
  });
}
