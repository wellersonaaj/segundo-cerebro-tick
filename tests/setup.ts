process.env.PORT = '3000';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-openai-key';
process.env.OPENAI_MODEL = 'gpt-5-mini';
process.env.MCP_TRANSPORT = 'stdio';
// NOTA: NÃO forçar RUN_OPENAI_INTEGRATION_TESTS=false aqui —
// testes que precisam de LLM real (ex: contextual-reasoner.eval) usam
// describeIf(isOpenAiIntegrationEnabled()) e devem respeitar a flag
// passada via CLI/shell. Default = false (testes LLM são skip).

import { resetEnvCache } from '../src/config/env.js';
import { resetSupabaseClient } from '../src/db/supabase.js';

resetEnvCache();
resetSupabaseClient();
