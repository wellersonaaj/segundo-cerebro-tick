/**
 * Remove todos os dados de homologação e recria o seed Genius Hotels.
 * Uso manual apenas — nunca chamar em runtime nem em npm test.
 *
 *   ALLOW_TEST_DATA_RESET=true npm run reset:test-data
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

const GENIUS_ENTITY_ID = 'a0000000-0000-4000-8000-000000000099';

/** Ordem respeitando FKs (filhos antes dos pais). */
const DELETE_ORDER = [
  'clarification_requests',
  'entity_resolution_logs',
  'event_entities',
  'assertions',
  'tasks',
  'events',
  'corrections',
  'inbox_items',
  'entity_aliases',
  'entities',
] as const;

/** Filtro PostgREST que corresponde a todas as linhas com coluna id uuid. */
const DELETE_ALL_SENTINEL = '00000000-0000-0000-0000-000000000000';

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

if (process.env.ALLOW_TEST_DATA_RESET !== 'true') {
  fail(
    'Abortado: defina ALLOW_TEST_DATA_RESET=true para confirmar que deseja apagar dados do banco configurado em .env.',
  );
}

let env;
try {
  env = loadEnv();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  fail('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em .env');
}

console.log('\n⚠️  RESET DE DADOS DE HOMOLOGAÇÃO');
console.log('   Este script REMOVE todos os registros das tabelas de fluxo listadas abaixo.');
console.log('   NÃO use em produção. NÃO há preservação seletiva por source_channel.');
console.log(`   Banco alvo: ${env.SUPABASE_URL}\n`);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function deleteAllRows(table: (typeof DELETE_ORDER)[number]): Promise<void> {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .neq('id', DELETE_ALL_SENTINEL);

  if (error) {
    fail(`${table}: ${error.message}`);
  }
  ok(`${table}: ${count ?? 0} removido(s)`);
}

async function ensureGeniusSeed(): Promise<void> {
  const { error: entityErr } = await supabase.from('entities').upsert(
    {
      id: GENIUS_ENTITY_ID,
      name: 'Genius Hotels',
      canonical_name: 'Genius Hotels',
      entity_type: 'company',
      normalized_name: 'genius hotels',
      status: 'active',
    },
    { onConflict: 'id' },
  );

  if (entityErr) {
    fail(`entities (seed Genius Hotels): ${entityErr.message}`);
  }

  const { error: aliasErr } = await supabase.from('entity_aliases').upsert(
    {
      entity_id: GENIUS_ENTITY_ID,
      alias: 'Genius',
      normalized_alias: 'genius',
    },
    { onConflict: 'normalized_alias' },
  );

  if (aliasErr) {
    fail(`entity_aliases (seed Genius): ${aliasErr.message}`);
  }

  ok('seed Genius Hotels + alias Genius (idempotente)');
}

async function main(): Promise<void> {
  console.log('Limpando tabelas (ordem FK)…\n');

  for (const table of DELETE_ORDER) {
    await deleteAllRows(table);
  }

  console.log('\nRecriando seed controlado…\n');
  await ensureGeniusSeed();

  console.log('\n=== Reset de homologação concluído ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
