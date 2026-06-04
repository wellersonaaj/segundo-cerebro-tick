import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AuditService } from '../services/audit.service.js';

const listQuerySchema = z.object({
  status: z.enum(['todos', 'revisar', 'falhas']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const PUBLIC_AUDIT_DIR = join(process.cwd(), 'public', 'audit');

async function readAuditAsset(filename: string): Promise<string> {
  return readFile(join(PUBLIC_AUDIT_DIR, filename), 'utf8');
}

export interface AuditRouteDeps {
  auditService: AuditService;
}

export async function registerAuditRoutes(
  app: FastifyInstance,
  deps: AuditRouteDeps,
): Promise<void> {
  const { auditService } = deps;

  app.get('/audit/inbox-items', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const result = await auditService.listInboxItems(parsed.data);
    return result;
  });

  app.get('/audit/inbox-items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await auditService.getInboxItemDetail(id);
    if (!detail) return reply.status(404).send({ error: 'Not found' });
    return detail;
  });

  app.get('/audit/styles.css', async (_req, reply) => {
    const css = await readAuditAsset('styles.css');
    return reply.type('text/css').send(css);
  });

  app.get('/audit/app.js', async (_req, reply) => {
    const js = await readAuditAsset('app.js');
    return reply.type('application/javascript').send(js);
  });

  app.get('/audit', async (_req, reply) => {
    const html = await readAuditAsset('index.html');
    return reply.type('text/html').send(html);
  });
}
