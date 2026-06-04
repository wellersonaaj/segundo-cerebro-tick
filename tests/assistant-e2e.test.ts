import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { AssistantTurnService } from '../src/services/assistant-turn.service.js';
import { clearAssistantTurnStore, getAssistantTurn } from '../src/services/assistant-turn.store.js';
import type { ClarificationRequest } from '../src/types/domain.js';

const GREENFIELD_ENV = {
  GREENFIELD_SCHEMA: 'true',
  EXTRACTOR_V14_SHADOW_ENABLED: 'true',
  PERSIST_COMPILED_MEMORY_V2: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key-min-1-chars-long',
};

function createMockDeps(overrides?: {
  processResult?: { processing_status: 'completed' | 'failed'; extraction_run_id?: string };
}) {
  const processResult = overrides?.processResult ?? {
    processing_status: 'completed' as const,
    extraction_run_id: 'run-1',
  };

  const inboxItem = {
    id: 'inbox-1',
    raw_content: 'Preciso falar com alguém do ESX',
    metadata: {},
  };

  return {
    inboxRepo: {
      findBySourceReference: vi.fn(async () => null as typeof inboxItem | null),
      create: vi.fn(async () => inboxItem),
      findById: vi.fn(async () => inboxItem),
      updateMetadata: vi.fn(async () => {}),
    },
    v14Process: {
      processById: vi.fn(async () => ({
        inbox_item_id: inboxItem.id,
        ...processResult,
        extractor_version: 'extractor-v1.4',
      })),
      reprocessById: vi.fn(),
    },
    clarificationsRepo: {
      listPendingByInboxItem: vi.fn(async () => [] as ClarificationRequest[]),
      listAnsweredByInboxItem: vi.fn(async () => [] as ClarificationRequest[]),
    },
    clarificationService: null,
    taskAuditRepo: {
      listByInboxItem: vi.fn(async () => [
        {
          id: 't1',
          inbox_item_id: 'inbox-1',
          title: 'Falar com ESX sobre prazo',
          description: null,
          status: 'open',
          task_kind: 'follow_up',
          due_at: null,
          target: null,
          source_excerpt: 'ESX',
        },
      ]),
    },
    runsV2Repo: {
      findById: vi.fn(async () => null),
    },
  };
}

describe('AssistantTurnService', () => {
  afterEach(() => {
    clearAssistantTurnStore();
    vi.restoreAllMocks();
    resetEnvCache();
  });

  it('sends ack before pipeline and follow-up after completion', async () => {
    Object.assign(process.env, GREENFIELD_ENV);
    resetEnvCache();
    const sent: string[] = [];
    const deps = createMockDeps();

    const service = new AssistantTurnService(
      deps.inboxRepo as never,
      deps.v14Process as never,
      deps.clarificationsRepo as never,
      deps.clarificationService,
      deps.taskAuditRepo as never,
      deps.runsV2Repo as never,
    );

    const ack = await service.startCapture({
      text: 'Preciso falar com alguém do ESX',
      thread_id: 'telegram:chat:123',
      channel: 'telegram',
      received_at: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      delivery: {
        sendAck: async (msg) => {
          sent.push(msg);
        },
        sendFollowUp: async (msg) => {
          sent.push(msg);
          return 99;
        },
      },
    });

    expect(sent[0]).toContain('Recebi');
    expect(ack.turn_id).toBeTruthy();

    await vi.waitFor(
      () => {
        expect(sent.length).toBeGreaterThanOrEqual(2);
        expect(getAssistantTurn(ack.turn_id)?.status).toBe('completed');
      },
      { timeout: 3000 },
    );

    expect(sent[1]).toContain('Organizei');
    expect(deps.v14Process.processById).toHaveBeenCalled();
  });

  it('skips duplicate telegram delivery for completed inbox', async () => {
    Object.assign(process.env, GREENFIELD_ENV);
    resetEnvCache();
    const deps = createMockDeps();
    const existingInbox = {
      id: 'inbox-existing',
      raw_content: 'mesma mensagem',
      processing_status: 'completed',
      metadata: {},
    };
    deps.inboxRepo.findBySourceReference = vi.fn(async () => existingInbox);

    const service = new AssistantTurnService(
      deps.inboxRepo as never,
      deps.v14Process as never,
      deps.clarificationsRepo as never,
      deps.clarificationService,
      deps.taskAuditRepo as never,
      deps.runsV2Repo as never,
    );

    const sent: string[] = [];
    await service.startCapture({
      text: 'mesma mensagem',
      thread_id: 'telegram:chat:123',
      channel: 'telegram',
      received_at: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      source_reference: 'telegram:chat:123:message:99',
      delivery: {
        sendAck: async (msg) => { sent.push(msg); },
        sendFollowUp: async (msg) => { sent.push(msg); return null; },
      },
    });

    await vi.waitFor(() => {
      expect(deps.v14Process.processById).not.toHaveBeenCalled();
    }, { timeout: 2000 });

    expect(sent).toHaveLength(1);
  });

  it('stores failed status when pipeline throws', async () => {
    Object.assign(process.env, GREENFIELD_ENV);
    resetEnvCache();
    const deps = createMockDeps();
    deps.v14Process.processById = vi.fn(async () => {
      throw new Error('pipeline boom');
    });

    const service = new AssistantTurnService(
      deps.inboxRepo as never,
      deps.v14Process as never,
      deps.clarificationsRepo as never,
      deps.clarificationService,
      deps.taskAuditRepo as never,
      deps.runsV2Repo as never,
    );

    const sent: string[] = [];
    const ack = await service.startCapture({
      text: 'teste',
      thread_id: 'api:thread-1',
      channel: 'api',
      received_at: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      delivery: {
        sendAck: async (msg) => { sent.push(msg); },
        sendFollowUp: async (msg) => { sent.push(msg); return null; },
      },
    });

    await vi.waitFor(
      () => {
        expect(getAssistantTurn(ack.turn_id)?.status).toBe('failed');
      },
      { timeout: 3000 },
    );

    expect(sent.some((m) => m.includes('Não consegui'))).toBe(true);
  });
});

describe('Telegram webhook assistant flow', () => {
  const TELEGRAM_ENV = {
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_ALLOWED_USER_ID: '5991664193',
    TELEGRAM_WEBHOOK_SECRET: 'segredo_gerado',
    TELEGRAM_WEBHOOK_URL: 'https://example.com/webhook/telegram-cerebro-tick',
    GREENFIELD_SCHEMA: 'true',
  };

  afterEach(() => {
    clearAssistantTurnStore();
    vi.restoreAllMocks();
    resetEnvCache();
  });

  it('returns 202 immediately for capture', async () => {
    Object.assign(process.env, GREENFIELD_ENV, TELEGRAM_ENV);
    resetEnvCache();

    const sentMessages: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string };
      if (body.text) sentMessages.push(body.text);
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 100 + sentMessages.length } }),
      };
    }) as unknown as typeof fetch;

    const deps = createMockDeps();
    const assistantTurn = new AssistantTurnService(
      deps.inboxRepo as never,
      deps.v14Process as never,
      deps.clarificationsRepo as never,
      deps.clarificationService,
      deps.taskAuditRepo as never,
      deps.runsV2Repo as never,
    );

    const { TelegramInboxService } = await import('../src/services/telegram-inbox.service.js');
    const { registerTelegramWebhookRoutes } = await import('../src/api/telegram-webhook.routes.js');
    const Fastify = (await import('fastify')).default;

    const app = Fastify({ logger: false });
    await registerTelegramWebhookRoutes(app, {
      telegramInbox: new TelegramInboxService(deps.inboxRepo as never, assistantTurn, null),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_ENV.TELEGRAM_WEBHOOK_SECRET },
      payload: {
        message: {
          message_id: 42,
          from: { id: 5991664193 },
          chat: { id: 5991664193 },
          date: 1_700_000_000,
          text: 'Preciso falar com alguém do ESX sobre prazo',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { accepted: boolean };
    expect(body.accepted).toBe(true);

    await vi.waitFor(() => expect(sentMessages.length).toBeGreaterThanOrEqual(2), {
      timeout: 3000,
    });

    await app.close();
  });
});
