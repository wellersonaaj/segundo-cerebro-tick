import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditService } from '../src/services/audit.service.js';

const sampleDetail = {
  inbox_item: {
    id: 'inbox-1',
    raw_content: 'Texto integral da entrada para auditoria.',
    source_channel: 'manual-assistido',
    source_mode: 'conversational',
    received_at: '2026-06-03T10:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    processing_status: 'completed',
    extractor_version: 'v1.4',
    processing_error: null,
    processed_at: '2026-06-03T10:01:00-03:00',
    active_extraction_run_id: 'run-1',
    latest_extraction_run_id: 'run-1',
    created_at: '2026-06-03T10:00:00-03:00',
  },
  entities: [{ id: 'e1', name: 'Tick', entity_type: 'person', registry_status: 'active' }],
  peripheral_terms: null,
  events: [
    {
      id: 'ev1',
      title: 'Reunião de alinhamento',
      event_type: 'meeting',
      occurred_at: null,
      record_status: 'active',
    },
  ],
  assertions: [
    {
      id: 'a1',
      content: 'Tick · status · ativo',
      assertion_kind: 'fact',
      assertion_kind_label: 'Fato',
      verification_status: 'unverified',
      confidence: 0.9,
    },
  ],
  tasks: [
    {
      id: 't1',
      title: 'Cobrar fornecedor',
      description: null,
      status: 'open',
      task_kind: 'follow_up',
      due_at: null,
      target: null,
      inbox_item_id: 'inbox-1',
      missing_target: true,
    },
  ],
  clarifications: [
    {
      id: 'c1',
      question: 'Qual fornecedor?',
      reason: 'missing target',
      priority: 'high',
      blocking_scope: 'task_execution',
      status: 'pending',
      source_excerpt: 'cobrar o fornecedor',
    },
  ],
  technical: {
    run_id: 'run-1',
    extractor_version: 'v1.4',
    processing_status: 'completed',
    processing_notes: ['note'],
    warnings: [],
    metadata: null,
    parsed_output: { ok: true },
    compiled_output: { compilerNotes: [] },
  },
  visual_status: 'revisar' as const,
  visual_status_label: 'Revisar',
  pending_clarifications_count: 1,
  has_warnings: false,
};

function createMockAuditService(): AuditService {
  return {
    listInboxItems: vi.fn(async ({ status, search } = {}) => {
      const items = [
        {
          id: 'inbox-1',
          raw_content_preview: 'Texto integral da entrada…',
          source_channel: 'manual-assistido',
          received_at: '2026-06-03T10:00:00-03:00',
          processing_status: 'completed',
          visual_status: 'revisar' as const,
          visual_status_label: 'Revisar',
          pending_clarifications_count: 1,
          has_warnings: false,
        },
        {
          id: 'inbox-2',
          raw_content_preview: 'Entrada falha',
          source_channel: 'telegram',
          received_at: '2026-06-02T10:00:00-03:00',
          processing_status: 'failed',
          visual_status: 'falhou' as const,
          visual_status_label: 'Falhou',
          pending_clarifications_count: 0,
          has_warnings: true,
        },
      ];

      let filtered = items;
      if (status === 'revisar') {
        filtered = items.filter((item) => item.visual_status === 'revisar');
      }
      if (status === 'falhas') {
        filtered = items.filter((item) => item.visual_status === 'falhou');
      }
      if (search) {
        filtered = filtered.filter((item) => item.raw_content_preview.includes(search));
      }
      return { items: filtered };
    }),
    getInboxItemDetail: vi.fn(async (id: string) => {
      if (id === 'inbox-1') return sampleDetail;
      return null;
    }),
  } as unknown as AuditService;
}

describe('Audit routes', () => {
  it('GET /audit returns html', async () => {
    const app = await buildApp({ auditService: createMockAuditService() });
    const res = await app.inject({ method: 'GET', url: '/audit' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Auditoria de entradas');
    await app.close();
  });

  it('GET /audit/inbox-items returns recent items', async () => {
    const auditService = createMockAuditService();
    const app = await buildApp({ auditService });
    const res = await app.inject({ method: 'GET', url: '/audit/inbox-items' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
    await app.close();
  });

  it('filters revisar and falhas', async () => {
    const app = await buildApp({ auditService: createMockAuditService() });
    const revisar = await app.inject({
      method: 'GET',
      url: '/audit/inbox-items?status=revisar',
    });
    expect(revisar.json().items).toHaveLength(1);
    expect(revisar.json().items[0].visual_status).toBe('revisar');

    const falhas = await app.inject({
      method: 'GET',
      url: '/audit/inbox-items?status=falhas',
    });
    expect(falhas.json().items).toHaveLength(1);
    expect(falhas.json().items[0].visual_status).toBe('falhou');
    await app.close();
  });

  it('supports simple search', async () => {
    const app = await buildApp({ auditService: createMockAuditService() });
    const res = await app.inject({
      method: 'GET',
      url: '/audit/inbox-items?search=integral',
    });
    expect(res.json().items).toHaveLength(1);
    await app.close();
  });

  it('GET /audit/inbox-items/:id returns detail payload', async () => {
    const app = await buildApp({ auditService: createMockAuditService() });
    const res = await app.inject({ method: 'GET', url: '/audit/inbox-items/inbox-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.inbox_item.raw_content).toContain('Texto integral');
    expect(body.entities).toHaveLength(1);
    expect(body.events).toHaveLength(1);
    expect(body.assertions).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.clarifications).toHaveLength(1);
    expect(body.technical.parsed_output).toEqual({ ok: true });
    await app.close();
  });

  it('returns 404 for missing detail', async () => {
    const app = await buildApp({ auditService: createMockAuditService() });
    const res = await app.inject({ method: 'GET', url: '/audit/inbox-items/missing' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('serves css with responsive media query', async () => {
    const app = await buildApp({ auditService: createMockAuditService() });
    const res = await app.inject({ method: 'GET', url: '/audit/styles.css' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('@media (max-width: 768px)');
    await app.close();
  });

  it('handles empty list from service', async () => {
    const auditService = createMockAuditService();
    vi.mocked(auditService.listInboxItems).mockResolvedValue({ items: [] });
    const app = await buildApp({ auditService });
    const res = await app.inject({ method: 'GET', url: '/audit/inbox-items' });
    expect(res.json().items).toEqual([]);
    await app.close();
  });

  it('detail template keeps technical details collapsed by default', () => {
    const appJs = readFileSync(join(process.cwd(), 'public', 'audit', 'app.js'), 'utf8');
    expect(appJs).toContain('<details class="technical">');
    expect(appJs).not.toContain('<details class="technical" open');
    expect(appJs).toContain('JSON.stringify(technicalJson, null, 2)');
  });
});

describe('Audit access in production without secret', () => {
  it('keeps audit shell public and blocks audit data API', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.INTERNAL_PROCESSING_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_PROCESSING_SECRET;

    const { resetEnvCache } = await import('../src/config/env.js');
    resetEnvCache();

    const app = await buildApp({ auditService: createMockAuditService() });
    const shell = await app.inject({ method: 'GET', url: '/audit' });
    expect(shell.statusCode).toBe(200);

    const data = await app.inject({ method: 'GET', url: '/audit/inbox-items' });
    expect(data.statusCode).toBe(503);

    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret) process.env.INTERNAL_PROCESSING_SECRET = originalSecret;
    resetEnvCache();
    await app.close();
  });
});
