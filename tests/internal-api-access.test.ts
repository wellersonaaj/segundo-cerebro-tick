import { describe, expect, it } from 'vitest';
import {
  enforceInternalApiAccess,
  isPublicRoute,
  isSensitiveInternalRoute,
} from '../src/config/internal-api-access.js';
import { resetEnvCache } from '../src/config/env.js';

function mockReply() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return reply;
}

describe('internal-api-access', () => {
  it('classifies public routes', () => {
    expect(isPublicRoute('GET', '/health')).toBe(true);
    expect(isPublicRoute('POST', '/webhooks/telegram')).toBe(true);
    expect(isPublicRoute('GET', '/audit')).toBe(true);
    expect(isPublicRoute('GET', '/audit/styles.css')).toBe(true);
    expect(isPublicRoute('GET', '/entities')).toBe(false);
    expect(isSensitiveInternalRoute('GET', '/inbox-items/abc')).toBe(true);
  });

  it('allows sensitive routes in test without secret', async () => {
    const req = { method: 'GET', url: '/entities', headers: {} } as never;
    const reply = mockReply();
    expect(enforceInternalApiAccess(req, reply as never)).toBe(true);
  });

  it('blocks sensitive routes in production without secret', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.INTERNAL_PROCESSING_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_PROCESSING_SECRET;
    resetEnvCache();

    const req = { method: 'GET', url: '/tasks', headers: {} } as never;
    const reply = mockReply();
    expect(enforceInternalApiAccess(req, reply as never)).toBe(false);
    expect(reply.statusCode).toBe(503);

    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret) process.env.INTERNAL_PROCESSING_SECRET = originalSecret;
    resetEnvCache();
  });

  it('requires header in production when secret configured', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.INTERNAL_PROCESSING_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.INTERNAL_PROCESSING_SECRET = 'test-secret';
    resetEnvCache();

    const blocked = mockReply();
    expect(
      enforceInternalApiAccess(
        { method: 'GET', url: '/memory/search?q=x', headers: {} } as never,
        blocked as never,
      ),
    ).toBe(false);
    expect(blocked.statusCode).toBe(401);

    const allowed = mockReply();
    expect(
      enforceInternalApiAccess(
        {
          method: 'GET',
          url: '/memory/search?q=x',
          headers: { 'x-internal-processing-secret': 'test-secret' },
        } as never,
        allowed as never,
      ),
    ).toBe(true);

    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret) process.env.INTERNAL_PROCESSING_SECRET = originalSecret;
    else delete process.env.INTERNAL_PROCESSING_SECRET;
    resetEnvCache();
  });

  it('keeps audit shell public in production without secret', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.INTERNAL_PROCESSING_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_PROCESSING_SECRET;
    resetEnvCache();

    const req = { method: 'GET', url: '/audit', headers: {} } as never;
    const reply = mockReply();
    expect(enforceInternalApiAccess(req, reply as never)).toBe(true);

    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret) process.env.INTERNAL_PROCESSING_SECRET = originalSecret;
    resetEnvCache();
  });
});
