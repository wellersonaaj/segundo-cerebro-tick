import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  isInternalProcessingConfigured,
  verifyInternalProcessingSecret,
} from '../config/internal-processing.js';
import {
  InboxItemProcessError,
  type InboxItemProcessService,
} from '../services/inbox-item-process.service.js';
import { sanitizeProcessingError } from '../utils/client-error.js';
import { log } from '../utils/logger.js';

export interface InternalInboxRouteDeps {
  inboxItemProcess: InboxItemProcessService;
}

function logProcessRequest(req: FastifyRequest, inboxItemId: string, step: string): void {
  log('info', 'internal_inbox_process', {
    step,
    inbox_item_id: inboxItemId,
    method: req.method,
    path: req.url,
  });
}

export async function registerInternalInboxRoutes(
  app: FastifyInstance,
  deps: InternalInboxRouteDeps,
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/internal/inbox-items/:id/process',
    async (req, reply) => {
      const inboxItemId = req.params.id;

      if (!isInternalProcessingConfigured()) {
        return reply.status(503).send({ ok: false, error: 'INTERNAL_PROCESSING_NOT_CONFIGURED' });
      }

      if (!verifyInternalProcessingSecret(req)) {
        log('warn', 'internal_inbox_process', {
          step: 'auth_rejected',
          inbox_item_id: inboxItemId,
        });
        return reply.status(401).send({ ok: false, error: 'Unauthorized' });
      }

      logProcessRequest(req, inboxItemId, 'request_received');

      try {
        const result = await deps.inboxItemProcess.processById(inboxItemId);
        logProcessRequest(req, inboxItemId, result.already_processed ? 'already_processed' : 'completed');
        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof InboxItemProcessError) {
          switch (err.code) {
            case 'INVALID_UUID':
              return reply.status(400).send({ ok: false, error: 'invalid_uuid' });
            case 'NOT_FOUND':
              return reply.status(404).send({ ok: false, error: 'inbox_item_not_found' });
            case 'ALREADY_PROCESSING':
            case 'RUN_ALREADY_IN_PROGRESS':
              return reply.status(409).send({
                ok: false,
                error: 'already_processing',
                inbox_item_id: err.details?.inbox_item_id ?? inboxItemId,
              });
            case 'PIPELINE_NOT_WIRED':
              return reply.status(503).send({
                ok: false,
                error: 'pipeline_not_wired',
                inbox_item_id: err.details?.inbox_item_id ?? inboxItemId,
              });
            default:
              break;
          }
        }

        const message = err instanceof Error ? err.message : String(err);
        log('error', 'internal_inbox_process', {
          step: 'processing_failed',
          inbox_item_id: inboxItemId,
          error: message,
        });
        return reply.status(500).send(sanitizeProcessingError());
      }
    },
  );
}
