import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerEntitiesRoutes } from '../src/api/entities.routes.js';
import { createScenarioExtractor } from './helpers/mock-extractor.js';

describe('API (unit — extractor mocked)', () => {
  it('GET /health returns ok', async () => {
    const app = await buildApp({ extract: createScenarioExtractor('case-01-past-event-no-date') });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('POST /inbox-items validates body', async () => {
    const app = await buildApp({ extract: createScenarioExtractor('case-01-past-event-no-date') });
    const res = await app.inject({
      method: 'POST',
      url: '/inbox-items',
      payload: { raw_content: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /entities/:id hydrates aliases from entity_aliases', async () => {
    const app = Fastify();
    const search = {
      getEntityDetails: vi.fn(async () => ({
        entity: {
          id: 'e1',
          name: 'Wellerson Assumpção',
          entity_type: 'person',
          normalized_name: 'wellerson assumpcao',
          status: 'active',
          superseded_by: null,
          created_at: '',
          updated_at: '',
        },
        aliases: ['Tick', 'Wellerson'],
        events: [],
        open_tasks: [],
      })),
    };

    await registerEntitiesRoutes(
      app,
      { findById: vi.fn(async () => ({ id: 'e1' })) } as never,
      { listByEntity: vi.fn(async () => []) } as never,
      search as never,
    );

    const res = await app.inject({ method: 'GET', url: '/entities/e1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().aliases).toEqual(['Tick', 'Wellerson']);
    await app.close();
  });
});
