import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache, validateGreenfieldEnvFlags } from '../src/config/env.js';
import type { Env } from '../src/config/env.js';

const BASE_ENV: Partial<Record<string, string>> = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

function envWith(overrides: Partial<Record<string, string>>): Env {
  return {
    PORT: 3000,
    NODE_ENV: 'development',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    OPENAI_MODEL: 'gpt-5-mini',
    MCP_TRANSPORT: 'stdio',
    RUN_OPENAI_INTEGRATION_TESTS: false,
    MEMORY_COMPILER_MODE: 'off',
    EXTRACTOR_RUNTIME_VERSION: 'v1.3',
    EXTRACTOR_V14_SHADOW_ENABLED: false,
    GREENFIELD_SCHEMA: false,
    PERSIST_COMPILED_MEMORY_V2: false,
    TELEGRAM_DEFAULT_TIMEZONE: 'America/Sao_Paulo',
    ...overrides,
  } as Env;
}

describe('greenfield env flag matrix (Bloco 6F)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('GREENFIELD + !SHADOW → GREENFIELD_SCHEMA_REQUIRES_EXTRACTOR_V14_SHADOW', () => {
    expect(() =>
      validateGreenfieldEnvFlags(
        envWith({
          GREENFIELD_SCHEMA: true,
          EXTRACTOR_V14_SHADOW_ENABLED: false,
          PERSIST_COMPILED_MEMORY_V2: true,
        }),
      ),
    ).toThrow('GREENFIELD_SCHEMA_REQUIRES_EXTRACTOR_V14_SHADOW');
  });

  it('GREENFIELD + !PERSIST → GREENFIELD_SCHEMA_REQUIRES_PERSIST_COMPILED_MEMORY_V2', () => {
    expect(() =>
      validateGreenfieldEnvFlags(
        envWith({
          GREENFIELD_SCHEMA: true,
          EXTRACTOR_V14_SHADOW_ENABLED: true,
          PERSIST_COMPILED_MEMORY_V2: false,
        }),
      ),
    ).toThrow('GREENFIELD_SCHEMA_REQUIRES_PERSIST_COMPILED_MEMORY_V2');
  });

  it('!GREENFIELD + PERSIST → PERSIST_COMPILED_MEMORY_V2_REQUIRES_GREENFIELD_SCHEMA', () => {
    expect(() =>
      validateGreenfieldEnvFlags(
        envWith({
          GREENFIELD_SCHEMA: false,
          PERSIST_COMPILED_MEMORY_V2: true,
        }),
      ),
    ).toThrow('PERSIST_COMPILED_MEMORY_V2_REQUIRES_GREENFIELD_SCHEMA');
  });

  it('GREENFIELD + SHADOW + PERSIST → ok via loadEnv', () => {
    Object.assign(process.env, BASE_ENV, {
      GREENFIELD_SCHEMA: 'true',
      EXTRACTOR_V14_SHADOW_ENABLED: 'true',
      PERSIST_COMPILED_MEMORY_V2: 'true',
    });
    resetEnvCache();
    const env = loadEnv();
    expect(env.GREENFIELD_SCHEMA).toBe(true);
    expect(env.EXTRACTOR_V14_SHADOW_ENABLED).toBe(true);
    expect(env.PERSIST_COMPILED_MEMORY_V2).toBe(true);
  });

  it('all flags off → ok via loadEnv', () => {
    Object.assign(process.env, BASE_ENV);
    resetEnvCache();
    const env = loadEnv();
    expect(env.GREENFIELD_SCHEMA).toBe(false);
    expect(env.PERSIST_COMPILED_MEMORY_V2).toBe(false);
  });

  it('SHADOW only without GREENFIELD → ok via loadEnv', () => {
    Object.assign(process.env, BASE_ENV, {
      EXTRACTOR_V14_SHADOW_ENABLED: 'true',
    });
    resetEnvCache();
    expect(() => loadEnv()).not.toThrow();
  });

  it('MEMORY_COMPILER_MODE=enforce → MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED', () => {
    Object.assign(process.env, BASE_ENV, {
      MEMORY_COMPILER_MODE: 'enforce',
    });
    resetEnvCache();
    expect(() => loadEnv()).toThrow('MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED');
  });
});
