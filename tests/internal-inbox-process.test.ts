import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetEnvCache } from '../src/config/env.js';
import { INTERNAL_PROCESSING_SECRET_HEADER } from '../src/config/internal-processing.js';
import {
  InboxItemProcessService,
  type InboxItemProcessPipeline,
} from '../src/services/inbox-item-process.service.js';
import type { InboxItem } from '../src/types/domain.js';
import { createScenarioExtractor } from './helpers/mock-extractor.js';

const INTERNAL_SECRET = 'test-internal-processing-secret';
const INBOX_ID = 'f0000000-0000-4000-8000-000000000001';
const EXTRACTOR = createScenarioExtractor('case-01-past-event-no-date');

function baseInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: INBOX_ID,
    raw_content: 'Texto de teste.',
    source_channel: 'telegram',
    source_mode: 'conversational',
    received_at: '2026-06-01T10:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    processing_status: 'pending',
    extractor_version: null,
    processing_error: null,
    processed_at: null,
    active_extraction_run_id: null,
    latest_extraction_run_id: null,
    created_at: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

function processUrl(id = INBOX_ID): string {
  return `/internal/inbox-items/${id}/process`;
}

async function buildInternalApp(
  findById: (id: string) => Promise<InboxItem | null>,
  pipeline: InboxItemProcessPipeline | null = null,
) {
  const inboxRepo = { findById: vi.fn(findById) };
  const inboxItemProcess = new InboxItemProcessService(inboxRepo as never, pipeline);
  return buildApp({ extract: EXTRACTOR, inboxItemProcess });
}

describe('POST /internal/inbox-items/:id/process (Checkpoint A)', () => {
  afterEach(() => {
    resetEnvCache();
    delete process.env.INTERNAL_PROCESSING_SECRET;
    vi.restoreAllMocks();
  });

  it('returns 503 when INTERNAL_PROCESSING_SECRET is not configured', async () => {
    resetEnvCache();
    const app = await buildInternalApp(async () => null);
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: 'any' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'INTERNAL_PROCESSING_NOT_CONFIGURED' });
    await app.close();
  });

  it('returns 401 when secret header is missing', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => null);
    const res = await app.inject({ method: 'POST', url: processUrl() });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 401 when secret is invalid', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => null);
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: 'wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 400 for invalid UUID', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => null);
    const res = await app.inject({
      method: 'POST',
      url: processUrl('not-a-uuid'),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_uuid' });
    await app.close();
  });

  it('returns 404 when inbox item does not exist', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => null);
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'inbox_item_not_found' });
    await app.close();
  });

  it('returns 200 idempotent when item is already completed', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const pipelineRun = vi.fn();
    const app = await buildInternalApp(
      async () =>
        baseInboxItem({
          processing_status: 'completed',
          active_extraction_run_id: 'a0000000-0000-4000-8000-000000000099',
          extractor_version: 'extractor-v1.4',
        }),
      { run: pipelineRun },
    );
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      already_processed: true,
      processing_status: 'completed',
      inbox_item_id: INBOX_ID,
      extraction_run_id: 'a0000000-0000-4000-8000-000000000099',
    });
    expect(pipelineRun).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 409 when item is already processing', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () =>
      baseInboxItem({ processing_status: 'processing' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'already_processing', inbox_item_id: INBOX_ID });
    await app.close();
  });

  it('returns 503 pipeline_not_wired for pending item when pipeline is null', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => baseInboxItem({ processing_status: 'pending' }));
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'pipeline_not_wired', inbox_item_id: INBOX_ID });
    await app.close();
  });

  it('returns 503 pipeline_not_wired for failed item until pipeline is wired', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () =>
      baseInboxItem({
        processing_status: 'failed',
        processing_error: 'previous failure',
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'pipeline_not_wired' });
    await app.close();
  });

  it('returns 409 when pipeline raises RUN_ALREADY_IN_PROGRESS', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => baseInboxItem({ processing_status: 'pending' }), {
      run: vi.fn(async () => {
        throw new Error('start_extraction_run: RUN_ALREADY_IN_PROGRESS: run-1');
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'already_processing' });
    await app.close();
  });

  it('returns 500 sanitized when pipeline throws unexpected error', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => baseInboxItem({ processing_status: 'pending' }), {
      run: vi.fn(async () => {
        throw new Error('OpenAI timeout');
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, error: 'processing_failed' });
    await app.close();
  });

  it('returns 200 completed when pipeline is wired for pending item', async () => {
    process.env.INTERNAL_PROCESSING_SECRET = INTERNAL_SECRET;
    resetEnvCache();
    const app = await buildInternalApp(async () => baseInboxItem({ processing_status: 'pending' }), {
      run: vi.fn(async () => ({
        inbox_item_id: INBOX_ID,
        processing_status: 'completed' as const,
        extraction_run_id: 'run-wired-1',
        extractor_version: 'extractor-v1.4',
      })),
    });
    const res = await app.inject({
      method: 'POST',
      url: processUrl(),
      headers: { [INTERNAL_PROCESSING_SECRET_HEADER]: INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      processing_status: 'completed',
      extraction_run_id: 'run-wired-1',
    });
    await app.close();
  });
});
