import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InboxItemEntitiesRepository } from '../repositories/inbox-item-entities.repository.js';
import type { EntitiesRepository } from '../repositories/entities.repository.js';
import type { ExtractionRunsRepository } from '../repositories/extraction-runs.repository.js';
import type { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { InboxProcessorService } from '../services/inbox-processor.service.js';
import type { CorrectionService, ReprocessService } from '../services/correction.service.js';
import { log } from '../utils/logger.js';

const createSchema = z.object({
  raw_content: z.string().min(1),
  source_channel: z.string().min(1),
  source_mode: z.enum(['conversational', 'passive']),
  received_at: z.string().datetime({ offset: true }),
  timezone: z.string().min(1),
});

const correctionSchema = z.object({
  correction_text: z.string().min(1),
});

function enrichInboxItem<T extends { active_extraction_run_id?: string | null }>(item: T) {
  return {
    ...item,
    has_active_memory: item.active_extraction_run_id != null,
  };
}

export interface InboxRouteDeps {
  processor: InboxProcessorService;
  corrections: CorrectionService;
  reprocess: ReprocessService;
  inboxRepo: InboxItemsRepository;
  runsRepo: ExtractionRunsRepository;
  inboxItemEntitiesRepo: InboxItemEntitiesRepository;
  entitiesRepo: EntitiesRepository;
}

export async function registerInboxRoutes(app: FastifyInstance, deps: InboxRouteDeps): Promise<void> {
  const {
    processor,
    corrections,
    reprocess,
    inboxRepo,
    runsRepo,
    inboxItemEntitiesRepo,
    entitiesRepo,
  } = deps;

  app.post('/inbox-items', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    log('info', 'inbox_flow', { step: 'request_start', path: '/inbox-items' });
    try {
      const result = await processor.process(parsed.data);
      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.get('/inbox-items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await inboxRepo.findById(id);
    if (!item) return reply.status(404).send({ error: 'Not found' });
    return enrichInboxItem(item);
  });

  app.get('/inbox-items/:id/runs', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await inboxRepo.findById(id);
    if (!item) return reply.status(404).send({ error: 'Not found' });
    const runs = await runsRepo.listByInboxItem(id);
    return { inbox_item_id: id, runs };
  });

  app.get('/inbox-items/:id/entities', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await inboxRepo.findById(id);
    if (!item) return reply.status(404).send({ error: 'Not found' });
    const links = await inboxItemEntitiesRepo.listActiveByInboxItem(id);
    const entities = await Promise.all(
      links.map(async (link) => ({
        ...link,
        entity: await entitiesRepo.findById(link.entity_id),
      })),
    );
    return { inbox_item_id: id, entities };
  });

  app.post('/inbox-items/:id/corrections', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    try {
      const result = await corrections.applyCorrection(id, parsed.data.correction_text);
      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });

  app.post('/inbox-items/:id/reprocess', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await reprocess.reprocess(id);
      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });
}
