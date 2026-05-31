import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InboxProcessorService } from '../services/inbox-processor.service.js';
import type { CorrectionService } from '../services/correction.service.js';
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

export async function registerInboxRoutes(
  app: FastifyInstance,
  processor: InboxProcessorService,
  corrections: CorrectionService,
): Promise<void> {
  app.post('/inbox-items', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    log('info', 'inbox_flow', { step: 'request_start', path: '/inbox-items' });
    try {
      const result = await processor.process(parsed.data);
      log('info', 'inbox_flow', {
        step: 'response_sent',
        inbox_item_id: result.inbox_item_id,
        processing_status: result.processing_status,
      });
      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'inbox_flow', {
        step: 'request_failed',
        path: '/inbox-items',
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return reply.status(500).send({ error: message });
    }
  });

  app.get('/inbox-items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await processor.getInboxRepo().findById(id);
    if (!item) return reply.status(404).send({ error: 'Not found' });
    return item;
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
}
