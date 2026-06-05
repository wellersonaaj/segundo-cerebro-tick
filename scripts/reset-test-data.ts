/**
 * Remove todos os dados de homologação e recria o seed Genius Hotels.
 * Uso manual apenas — nunca chamar em runtime nem em npm test.
 *
 *   ALLOW_TEST_DATA_RESET=true npm run reset:test-data
 *   ALLOW_TEST_DATA_RESET=true RESET_SKIP_GENIUS_SEED=true npm run reset:test-data
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/config/env.js';
import {
  evaluateResetCounts,
  FLOW_TABLES,
  isBlockedProductionTarget,
} from './lib/reset-verification.js';

loadDotEnv();

export const GENIUS_ENTITY_ID = 'a0000000-0000-4000-8000-000000000099';

/** Filtro PostgREST que corresponde a todas as linhas com coluna id uuid. */
const DELETE_ALL_SENTINEL = '00000000-0000-0000-0000-000000000000';

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

async function nullifyColumn(
  supabase: SupabaseClient,
  table: string,
  column: string,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ [column]: null })
    .neq('id', DELETE_ALL_SENTINEL);
  if (error) fail(`${table}.${column} nullify: ${error.message}`);
  ok(`${table}.${column} anulado`);
}

async function deleteAllRows(supabase: SupabaseClient, table: string): Promise<void> {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .neq('id', DELETE_ALL_SENTINEL);

  if (error) {
    fail(`${table}: ${error.message}`);
  }
  ok(`${table}: ${count ?? 0} removido(s)`);
}

async function ensureGeniusSeed(supabase: SupabaseClient): Promise<void> {
  const { error: entityErr } = await supabase.from('entities').upsert(
    {
      id: GENIUS_ENTITY_ID,
      name: 'Genius Hotels',
      canonical_name: 'Genius Hotels',
      entity_type: 'company',
      normalized_name: 'genius hotels',
      registry_status: 'active',
      created_by_extraction_run_id: null,
    },
    { onConflict: 'id' },
  );

  if (entityErr) {
    fail(`entities (seed Genius Hotels): ${entityErr.message}`);
  }

  const { data: existingAlias, error: aliasLookupErr } = await supabase
    .from('entity_aliases')
    .select('id')
    .eq('normalized_alias', 'genius')
    .eq('registry_status', 'active')
    .maybeSingle();

  if (aliasLookupErr) {
    fail(`entity_aliases (seed Genius lookup): ${aliasLookupErr.message}`);
  }

  if (!existingAlias) {
    const { error: aliasErr } = await supabase.from('entity_aliases').insert({
      entity_id: GENIUS_ENTITY_ID,
      alias: 'Genius',
      normalized_alias: 'genius',
      registry_status: 'active',
      created_by_extraction_run_id: null,
    });

    if (aliasErr) {
      fail(`entity_aliases (seed Genius): ${aliasErr.message}`);
    }
  }

  ok('seed Genius Hotels + alias Genius (idempotente)');
}

export async function runHomologReset(supabase: SupabaseClient): Promise<void> {
  console.log('Limpando tabelas (ordem FK)…\n');

  // 1. Filhos de runs + inbox
  await deleteAllRows(supabase, 'entity_alias_evidences');
  await deleteAllRows(supabase, 'inbox_item_entities');
  await deleteAllRows(supabase, 'clarification_requests');
  await deleteAllRows(supabase, 'entity_resolution_logs');
  await deleteAllRows(supabase, 'event_entities');
  await deleteAllRows(supabase, 'assertion_entities');
  await deleteAllRows(supabase, 'task_mutations');
  await deleteAllRows(supabase, 'assertions');
  await deleteAllRows(supabase, 'events');
  await deleteAllRows(supabase, 'tasks');

  // 2. Quebrar referências circulares inbox ↔ runs ↔ registry
  await nullifyColumn(supabase, 'inbox_items', 'active_extraction_run_id');
  await nullifyColumn(supabase, 'inbox_items', 'latest_extraction_run_id');
  await nullifyColumn(supabase, 'entities', 'created_by_extraction_run_id');
  await nullifyColumn(supabase, 'entity_aliases', 'created_by_extraction_run_id');

  // 3. Runs e fluxo inbox
  await deleteAllRows(supabase, 'inbox_extraction_runs');
  await deleteAllRows(supabase, 'corrections');
  await deleteAllRows(supabase, 'inbox_items');

  // 4. Registry (recriado via seed)
  await deleteAllRows(supabase, 'entity_aliases');
  await deleteAllRows(supabase, 'entities');

  if (process.env.RESET_SKIP_GENIUS_SEED === 'true') {
    ok('seed Genius Hotels omitido (RESET_SKIP_GENIUS_SEED=true)');
  } else {
    console.log('\nRecriando seed controlado…\n');
    await ensureGeniusSeed(supabase);
  }
}

export async function verifyHomologReset(supabase: SupabaseClient): Promise<void> {
  const counts: Array<{ table: string; count: number }> = [];

  for (const table of [...FLOW_TABLES, 'entities', 'entity_aliases', 'tasks'] as const) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) fail(`verify ${table}: ${error.message}`);
    counts.push({ table, count: count ?? 0 });
  }

  const geniusSeedExpected = process.env.RESET_SKIP_GENIUS_SEED !== 'true';
  const result = evaluateResetCounts(counts, { geniusSeedExpected });
  console.log('\nVerificação pós-reset:');
  for (const [table, n] of Object.entries(result.counts)) {
    console.log(`  ${table}: ${n}`);
  }

  if (!result.ok) {
    for (const f of result.failures) console.error(`  ✗ ${f}`);
    fail('Verificação pós-reset falhou');
  }
  ok('Verificação pós-reset OK');
}

async function main(): Promise<void> {
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

  const blocked = isBlockedProductionTarget(env.SUPABASE_URL, env.NODE_ENV);
  if (blocked) fail(blocked);

  console.log('\n⚠️  RESET DE DADOS DE HOMOLOGAÇÃO');
  console.log('   Este script REMOVE todos os registros das tabelas de fluxo listadas abaixo.');
  console.log('   NÃO use em produção. policies e migrations não são alteradas.');
  console.log(`   Banco alvo: ${env.SUPABASE_URL}\n`);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await runHomologReset(supabase);
  await verifyHomologReset(supabase);

  console.log('\n=== Reset de homologação concluído ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
