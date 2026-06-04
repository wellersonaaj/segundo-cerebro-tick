import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createNoOpDelivery } from '../services/assistant-delivery.js';
import { getAssistantTurn } from '../services/assistant-turn.store.js';
import type { AssistantSessionService } from '../services/assistant-session.service.js';
import type { AssistantTurnService } from '../services/assistant-turn.service.js';
import { buildAssistantThreadId } from '../services/assistant-session.service.js';

export interface AssistantRouteDeps {
  assistantTurn: AssistantTurnService;
  session?: AssistantSessionService;
}

interface PostMessageBody {
  text?: string;
  thread_id?: string;
  channel?: 'api';
  timezone?: string;
}

export async function registerAssistantRoutes(
  app: FastifyInstance,
  deps: AssistantRouteDeps,
): Promise<void> {
  app.post<{ Body: PostMessageBody }>('/assistant/messages', async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) {
      return reply.status(400).send({ ok: false, error: 'text is required' });
    }

    const env = loadEnv();
    const threadId =
      req.body?.thread_id?.trim() ||
      buildAssistantThreadId('api', randomUUID());
    const timezone = req.body?.timezone?.trim() || env.TELEGRAM_DEFAULT_TIMEZONE || 'America/Sao_Paulo';

    try {
      const ack = await deps.assistantTurn.startCapture({
        text,
        thread_id: threadId,
        channel: 'api',
        received_at: new Date().toISOString(),
        timezone,
        source_reference: `api:thread:${threadId}:turn:${randomUUID()}`,
        metadata: {
          assistant: { thread_id: threadId },
          source_metadata: { routing: { thread_reference: threadId } },
        },
        delivery: createNoOpDelivery(),
      });

      return reply.status(202).send({
        ok: true,
        turn_id: ack.turn_id,
        thread_id: ack.thread_id,
        ack_message: ack.ack_message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ ok: false, error: message });
    }
  });

  app.get<{ Params: { turnId: string } }>('/assistant/turns/:turnId', async (req, reply) => {
    const turn = getAssistantTurn(req.params.turnId);
    if (!turn) {
      return reply.status(404).send({ ok: false, error: 'turn_not_found' });
    }

    return reply.send({
      ok: true,
      turn_id: turn.turn_id,
      thread_id: turn.thread_id,
      status: turn.status,
      ack_message: turn.ack_message,
      follow_up_message: turn.follow_up_message,
      inbox_item_id: turn.inbox_item_id,
      extraction_run_id: turn.extraction_run_id,
      error: turn.error,
      created_at: turn.created_at,
      completed_at: turn.completed_at,
    });
  });

  app.post<{
    Params: { clarificationId: string };
    Body: { answer?: string; thread_id?: string; inbox_item_id?: string };
  }>('/assistant/clarifications/:clarificationId/resolve', async (req, reply) => {
    const answer = req.body?.answer?.trim();
    const inboxItemId = req.body?.inbox_item_id?.trim();
    const threadId = req.body?.thread_id?.trim();
    if (!answer || !inboxItemId || !threadId) {
      return reply.status(400).send({
        ok: false,
        error: 'answer, inbox_item_id and thread_id are required',
      });
    }

    try {
      const ack = await deps.assistantTurn.resolveClarification({
        clarification_id: req.params.clarificationId,
        inbox_item_id: inboxItemId,
        answer,
        thread_id: threadId,
        channel: 'api',
        delivery: createNoOpDelivery(),
      });

      return reply.status(202).send({
        ok: true,
        turn_id: ack.turn_id,
        thread_id: ack.thread_id,
        ack_message: ack.ack_message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ ok: false, error: message });
    }
  });

  app.get<{ Params: { threadId: string } }>('/assistant/threads/:threadId', async (req, reply) => {
    if (!deps.session) {
      return reply.status(503).send({ ok: false, error: 'session_not_configured' });
    }
    const threadId = decodeURIComponent(req.params.threadId);
    const [recentInboxes, pendingClarifications, openTasks] = await Promise.all([
      deps.session.listRecentInboxesForThread(threadId),
      deps.session.listPendingClarificationsForThread(threadId),
      deps.session.listOpenTasksSnapshot(10),
    ]);
    return reply.send({
      ok: true,
      thread_id: threadId,
      recent_inbox_item_ids: recentInboxes.map((i) => i.id),
      pending_clarifications: pendingClarifications.length,
      open_tasks_count: openTasks.length,
    });
  });
}
