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
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int().positive().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  TELEGRAM_DEFAULT_TIMEZONE: z.string().min(1).default('America/Sao_Paulo'),
  TELEGRAM_SENDER_ENTITY_REFERENCE: z.string().min(1).optional(),
  INTERNAL_PROCESSING_SECRET: z.string().min(1).optional(),

  // Orquestrador unificado (Fase 0-6)
  LOG_DIR: z.string().min(1).optional(),
  INTENT_CLASSIFIER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  INTENT_CLASSIFIER_MODEL: z.string().min(1).default('gpt-5-mini'),
  // Phase 5 — Contextual Reasoner (roleta entre inbox e extraction)
  // Default: false. Quando true, adiciona um LLM call (gpt-4o-mini) por save
  // que decide o que fazer com a msg dado clarifs pendentes + thread + tasks.
  // Resolved J1 (prazo repetido em sub-task) + J3 (clarif pile-up).
  REASONER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  REASONER_MODEL: z.string().min(1).default('gpt-4o-mini'),
  RAG_RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(10),
  RAG_RERANK_KEEP_INBOX: z.coerce.number().int().positive().default(5),
  RAG_RERANK_KEEP_ASSERTIONS: z.coerce.number().int().positive().default(3),
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

export function loadEnv(overrides?: Partial<Record<string, string>>): Env {
  if (cached && !overrides) return cached;
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return parsed.data;
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
    maxQueries: env.ENRICHMENT_MAX_QUERIES_PER_RUN,
    autoApplyConfidence: env.ENRICHMENT_AUTO_APPLY_CONFIDENCE,
    suggestConfidence: env.ENRICHMENT_SUGGEST_CONFIDENCE,
    webSearchProvider: env.WEB_SEARCH_PROVIDER,
    webSearchApiKey: env.WEB_SEARCH_API_KEY,
  };
}
