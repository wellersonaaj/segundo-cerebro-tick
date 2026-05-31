import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
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
});
