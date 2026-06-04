import { loadDotEnv } from '../../src/config/load-dotenv.js';
import { loadEnv } from '../../src/config/env.js';

loadDotEnv();

export const GENIUS_HOTELS_ENTITY_ID = 'a0000000-0000-4000-8000-000000000099';

export const PORT = process.env.PORT ?? '3000';
export const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export const HTTP_SMOKE_TIMEOUT_MS = 180_000;

export function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

export function ok(message: string): void {
  console.log(`✓ ${message}`);
}

export function requireEnv(keys: readonly string[]): void {
  const missing = keys.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    fail(`Variáveis ausentes: ${missing.join(', ')}. Configure .env.`);
  }
}

export function loadHomologEnv() {
  try {
    return loadEnv();
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

export async function fetchJson(
  path: string,
  init?: RequestInit,
  timeoutMs = HTTP_SMOKE_TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const hasBody = init?.body != null && init.body !== '';
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      fail(`${init?.method ?? 'GET'} ${path} excedeu timeout de ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeQuestion(q: string): string {
  return q.trim().replace(/\?$/, '').toLowerCase();
}
