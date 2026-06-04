import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ClarificationService } from '../services/clarification.service.js';

const resolveSchema = z.object({
  answer: z.string().min(1),
  apply: z.boolean().optional(),
});

export async function registerClarificationsRoutes(
  app: FastifyInstance,
  clarifications: ClarificationService,
): Promise<void> {
  app.get('/clarifications', async (req) => {
    const status = (req.query as { status?: string }).status;
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    if (status === 'pending') return clarifications.listPending(limit);
    return clarifications.list(
      status as 'pending' | 'answered' | 'dismissed' | 'resolved_automatically' | undefined,
      limit,
    );
  });

  app.post('/clarifications/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    try {
      return await clarifications.resolveAndApply(id, parsed.data.answer, {
        apply: parsed.data.apply,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/clarifications/:id/dismiss', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await clarifications.dismiss(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) return reply.status(404).send({ error: message });
      return reply.status(500).send({ error: message });
    }
  });
}
