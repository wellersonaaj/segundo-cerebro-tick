import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  MCP_TRANSPORT: z.enum(['stdio']).default('stdio'),
  RUN_OPENAI_INTEGRATION_TESTS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  MEMORY_COMPILER_MODE: z.enum(['off', 'shadow', 'enforce']).default('off'),
  EXTRACTOR_RUNTIME_VERSION: z.enum(['v1.3', 'v1.4']).default('v1.3'),
  EXTRACTOR_V14_SHADOW_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  GREENFIELD_SCHEMA: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  PERSIST_COMPILED_MEMORY_V2: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int().positive().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  TELEGRAM_DEFAULT_TIMEZONE: z.string().min(1).default('America/Sao_Paulo'),
  TELEGRAM_SENDER_ENTITY_REFERENCE: z.string().min(1).optional(),
  INTERNAL_PROCESSING_SECRET: z.string().min(1).optional(),
  EXTERNAL_KNOWLEDGE_ENRICHMENT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  WEB_SEARCH_PROVIDER: z.enum(['tavily', 'mock']).default('tavily'),
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  ENRICHMENT_MAX_QUERIES_PER_RUN: z.coerce.number().int().positive().default(2),
  ENRICHMENT_AUTO_APPLY_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.9),
  ENRICHMENT_SUGGEST_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Valida combinações greenfield / persistência v2 (Bloco 6F). Exportado para testes. */
export function validateGreenfieldEnvFlags(data: Env): void {
  if (data.MEMORY_COMPILER_MODE === 'enforce') {
    throw new Error('MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED');
  }
  if (data.EXTRACTOR_RUNTIME_VERSION === 'v1.4') {
    throw new Error('EXTRACTOR_V14_RUNTIME_NOT_ENABLED');
  }
  if (data.GREENFIELD_SCHEMA === true && data.EXTRACTOR_V14_SHADOW_ENABLED !== true) {
    throw new Error('GREENFIELD_SCHEMA_REQUIRES_EXTRACTOR_V14_SHADOW');
  }
  if (data.GREENFIELD_SCHEMA === true && data.PERSIST_COMPILED_MEMORY_V2 !== true) {
    throw new Error('GREENFIELD_SCHEMA_REQUIRES_PERSIST_COMPILED_MEMORY_V2');
  }
  if (data.GREENFIELD_SCHEMA !== true && data.PERSIST_COMPILED_MEMORY_V2 === true) {
    throw new Error('PERSIST_COMPILED_MEMORY_V2_REQUIRES_GREENFIELD_SCHEMA');
  }
}

export function loadEnv(overrides?: Partial<Record<string, string>>): Env {
  if (cached && !overrides) return cached;
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  validateGreenfieldEnvFlags(parsed.data);
  cached = parsed.data;
  return parsed.data;
}

export function isExtractorV14ShadowEnabled(): boolean {
  return loadEnv().EXTRACTOR_V14_SHADOW_ENABLED === true;
}

export function isGreenfieldSchemaEnabled(): boolean {
  return loadEnv().GREENFIELD_SCHEMA === true;
}

export function isPersistCompiledMemoryV2Enabled(): boolean {
  return loadEnv().PERSIST_COMPILED_MEMORY_V2 === true;
}

export function getExtractorRuntimeVersion(): 'v1.3' | 'v1.4' {
  return loadEnv().EXTRACTOR_RUNTIME_VERSION;
}

export function getMemoryCompilerMode(): 'off' | 'shadow' {
  const mode = loadEnv().MEMORY_COMPILER_MODE;
  if (mode === 'enforce') {
    throw new Error('MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED');
  }
  return mode === 'shadow' ? 'shadow' : 'off';
}

export function resetEnvCache(): void {
  cached = null;
}

export function isOpenAiIntegrationEnabled(): boolean {
  return loadEnv().RUN_OPENAI_INTEGRATION_TESTS === true;
}

export function isExternalKnowledgeEnrichmentEnabled(): boolean {
  return loadEnv().EXTERNAL_KNOWLEDGE_ENRICHMENT_ENABLED === true;
}

export function getEnrichmentOptions() {
  const env = loadEnv();
  return {
    enabled: env.EXTERNAL_KNOWLEDGE_ENRICHMENT_ENABLED === true,
    maxQueries: env.ENRICHMENT_MAX_QUERIES_PER_RUN,
    autoApplyConfidence: env.ENRICHMENT_AUTO_APPLY_CONFIDENCE,
    suggestConfidence: env.ENRICHMENT_SUGGEST_CONFIDENCE,
    webSearchProvider: env.WEB_SEARCH_PROVIDER,
    webSearchApiKey: env.WEB_SEARCH_API_KEY,
  };
}
