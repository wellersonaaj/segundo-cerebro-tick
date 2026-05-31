/**
 * Verifica se `.env` está salvo e se Supabase responde.
 * Uso: npm run verify:env
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'] as const;

/** Marcador fixo para linhas temporárias do probe de processing_status (cleanup em finally). */
const VERIFY_ENV_PROBE_MARKER = '__verify_env_probe__';

const MVP_PROCESSING_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

/** Colunas obrigatórias para o fluxo E2E (001 + 002 + 004 + 005 + 006 + 007). */
const SCHEMA_CHECKS: ReadonlyArray<{ table: string; columns: string; label: string }> = [
  {
    table: 'inbox_items',
    columns:
      'id, raw_content, source_channel, source_mode, received_at, timezone, processing_status, extractor_version, processing_error, created_at, updated_at',
    label: 'inbox_items (001/004/007 — processing_status)',
  },
  {
    table: 'entities',
    columns:
      'id, name, canonical_name, entity_type, normalized_name, status, created_at, updated_at',
    label: 'entities (001/005 legacy canonical_name)',
  },
  {
    table: 'events',
    columns:
      'id, inbox_item_id, event_type, description, occurred_at, source_excerpt, confidence, status, created_at',
    label: 'events (001/006 — occurred_at nullable)',
  },
  {
    table: 'event_entities',
    columns: 'id, event_id, entity_id, role, created_at',
    label: 'event_entities (001)',
  },
  {
    table: 'assertions',
    columns:
      'id, inbox_item_id, assertion_type, content, status, source_excerpt, record_status, created_at',
    label: 'assertions (001)',
  },
  {
    table: 'tasks',
    columns:
      'id, inbox_item_id, title, due_at, source_excerpt, is_commitment, status, created_at, updated_at',
    label: 'tasks (001)',
  },
  {
    table: 'entity_aliases',
    columns: 'id, entity_id, alias, normalized_alias, created_at',
    label: 'entity_aliases (002/005 legacy created_at)',
  },
  {
    table: 'entity_resolution_logs',
    columns:
      'id, inbox_item_id, extracted_entity_name, resolution_status, resolved_entity_id, evidence, created_at',
    label: 'entity_resolution_logs (002)',
  },
  {
    table: 'clarification_requests',
    columns:
      'id, inbox_item_id, target_type, target_reference, issue_type, question, reason, priority, blocking_scope, suggested_answers, source_excerpt, status, created_at, updated_at',
    label: 'clarification_requests (002)',
  },
  {
    table: 'corrections',
    columns: 'id, inbox_item_id, correction_text, created_at',
    label: 'corrections (002)',
  },
];

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function checkTableSchema(
  supabase: SupabaseClient,
  check: { table: string; columns: string; label: string },
): Promise<void> {
  const { error } = await supabase.from(check.table).select(check.columns).limit(0);
  if (error?.code === '42P01') {
    fail(
      `Tabela ${check.table} ausente. Rode 001_core.sql, 002_clarifications_and_resolution.sql e, ` +
        'em bancos parciais, 004–007 (005 defaults, 006 occurred_at, 007 processing_status).',
    );
  }
  if (error) {
    const hint =
      error.message.includes('schema cache') || error.message.includes('column')
        ? ' Rode 004_align_existing_schema.sql, 005–007 no SQL Editor (legados).'
        : '';
    fail(`Schema ${check.label}: ${error.message}.${hint}`);
  }
  console.log(`OK: ${check.label}`);
}

const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  fail(
    `Variáveis vazias: ${missing.join(', ')}. Salve o arquivo .env (Cmd+S) e preencha os valores.`,
  );
}

let env;
try {
  env = loadEnv();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

console.log('OK: variáveis carregadas');
console.log('  SUPABASE_URL:', env.SUPABASE_URL);
console.log(
  '  SUPABASE_SERVICE_ROLE_KEY:',
  env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')
    ? `sb_secret_... (${env.SUPABASE_SERVICE_ROLE_KEY.length} chars)`
    : `(${env.SUPABASE_SERVICE_ROLE_KEY.length} chars)`,
);

const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
});

if (res.status === 401) {
  fail('Supabase rejeitou a secret key (HTTP 401). Copie de novo em Settings → API → Secret keys.');
}
if (!res.ok) {
  fail(`Supabase respondeu HTTP ${res.status}`);
}
console.log('OK: Supabase autenticou (HTTP', res.status + ')');

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const check of SCHEMA_CHECKS) {
  await checkTableSchema(supabase, check);
}

/** Coluna existe e é consultável; não exige NOT NULL (006). */
async function checkEventsOccurredAtColumn(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from('events').select('occurred_at').is('occurred_at', null).limit(0);
  if (error) {
    fail(
      `Coluna events.occurred_at ausente ou inacessível: ${error.message}. ` +
        'Rode 006_allow_events_occurred_at_null.sql se o banco legado impõe NOT NULL.',
    );
  }
  console.log('OK: events.occurred_at presente (nullable permitido; sem exigir NOT NULL)');
}

await checkEventsOccurredAtColumn(supabase);

/**
 * Probe comportamental da CHECK inbox_items_processing_status_check.
 * O Supabase JS Client não expõe pg_constraint; 007 é obrigatória em bancos legados.
 */
async function checkInboxProcessingStatusConstraint(supabase: SupabaseClient): Promise<void> {
  const probeBase = {
    raw_content: VERIFY_ENV_PROBE_MARKER,
    source_channel: 'verify-env',
    source_mode: 'passive' as const,
    received_at: '2000-01-01T00:00:00Z',
    timezone: 'UTC',
  };

  const createdIds: string[] = [];

  const cleanup = async (): Promise<void> => {
    if (createdIds.length > 0) {
      await supabase.from('inbox_items').delete().in('id', createdIds);
    }
    await supabase
      .from('inbox_items')
      .delete()
      .eq('raw_content', VERIFY_ENV_PROBE_MARKER)
      .eq('source_channel', 'verify-env');
  };

  try {
    const { data: completedRow, error: completedErr } = await supabase
      .from('inbox_items')
      .insert({ ...probeBase, processing_status: 'completed' })
      .select('id')
      .single();

    if (completedErr) {
      const isCheck =
        completedErr.message.includes('inbox_items_processing_status_check') ||
        completedErr.message.includes('check constraint');
      fail(
        isCheck
          ? `Constraint legada rejeita processing_status=completed: ${completedErr.message}. Rode 007_align_inbox_processing_status.sql no SQL Editor.`
          : `Probe completed falhou: ${completedErr.message}`,
      );
    }
    if (completedRow?.id) createdIds.push(completedRow.id as string);

    const { data: processedRow, error: processedErr } = await supabase
      .from('inbox_items')
      .insert({ ...probeBase, processing_status: 'processed' })
      .select('id')
      .single();

    if (!processedErr) {
      if (processedRow?.id) createdIds.push(processedRow.id as string);
      fail(
        'Banco ainda aceita processing_status=processed (constraint legada). ' +
          'Valores MVP: ' +
          MVP_PROCESSING_STATUSES.join(', ') +
          '. Rode 007_align_inbox_processing_status.sql.',
      );
    }

    const processedRejected =
      processedErr.message.includes('inbox_items_processing_status_check') ||
      processedErr.message.includes('check constraint') ||
      processedErr.code === '23514';
    if (!processedRejected) {
      fail(`Probe processed inesperado: ${processedErr.message}`);
    }

    console.log(
      'OK: inbox_items.processing_status — completed aceito; processed rejeitado (contrato 001/007)',
    );
  } finally {
    await cleanup();
  }
}

await checkInboxProcessingStatusConstraint(supabase);

const { data: geniusSeed } = await supabase
  .from('entities')
  .select('id')
  .eq('normalized_name', 'genius hotels')
  .maybeSingle();
if (geniusSeed) {
  console.log('OK: migration 003 (opcional) — seed Genius Hotels presente');
} else {
  console.warn(
    'WARN: seed Genius ausente — aplique 003_seed_genius_example.sql para o cenário E2E completo.',
  );
}

console.log('\nTudo certo. Rode: npm run dev && npm run test:e2e:smoke');
