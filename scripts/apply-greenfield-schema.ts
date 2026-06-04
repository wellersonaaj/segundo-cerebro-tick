/**
 * Aplica schema greenfield v2 (3 migrations) via Postgres direto.
 *
 * ATENÇÃO: dropa todas as tabelas do schema public do Segundo Cérebro.
 *
 *   ALLOW_GREENFIELD_SCHEMA_APPLY=true \
 *   GREENFIELD_SCHEMA_APPLY_CONFIRM=<hostname do Supabase> \
 *   SUPABASE_DB_PASSWORD='...' npm run db:apply-greenfield-schema
 *
 * Ou DATABASE_URL completa (confirm host deve bater com hostname da URL).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { isBlockedProductionTarget } from './lib/reset-verification.js';

loadDotEnv();

const MIGRATIONS = [
  '20260602100000_greenfield_baseline.sql',
  '20260602100001_greenfield_rpcs.sql',
  '20260602100002_greenfield_seeds.sql',
  '20260603120000_s1_simplify_promote_blocking_scope.sql',
  '20260603130000_s2_external_action_no_promote_block.sql',
  '20260604000001_persist_rpc_indexes.sql',
  '20260604000000_persist_extraction_candidates.sql',
  '20260604110000_fix_due_at_instant_cast.sql',
  '20260604120000_cleanup_duplicate_entities.sql',
  '20260604130000_persist_entity_upsert_do_nothing.sql',
] as const;

const MIGRATION_LABELS: Record<(typeof MIGRATIONS)[number], string> = {
  '20260602100000_greenfield_baseline.sql': 'baseline applied',
  '20260602100001_greenfield_rpcs.sql': 'RPCs applied',
  '20260602100002_greenfield_seeds.sql': 'seeds applied',
  '20260603120000_s1_simplify_promote_blocking_scope.sql': 'S1 promote blocking_scope applied',
  '20260603130000_s2_external_action_no_promote_block.sql': 'S2 external_action no promote block applied',
  '20260604000001_persist_rpc_indexes.sql': 'persist RPC indexes applied',
  '20260604000000_persist_extraction_candidates.sql': 'persist_extraction_candidates RPC applied',
  '20260604110000_fix_due_at_instant_cast.sql': 'persist_extraction_candidates due_at_instant ISO guard applied',
  '20260604120000_cleanup_duplicate_entities.sql': 'cleanup duplicate rejected entities (smoke residue)',
  '20260604130000_persist_entity_upsert_do_nothing.sql': 'persist entity upsert do nothing (race hygiene)',
};

const DROP_GREENFIELD_OBJECTS = `
drop function if exists public.persist_extraction_candidates(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) cascade;
drop function if exists public.fail_extraction_run(uuid, text) cascade;
drop function if exists public.promote_extraction_run(uuid) cascade;
drop function if exists public.start_extraction_run(uuid, text, text, text, text, text, text, text, uuid, text) cascade;
drop function if exists public.start_extraction_run(uuid, text, text, text, text, text, uuid, text) cascade;
drop function if exists public.apply_task_mutations_for_run(uuid) cascade;
drop function if exists public.map_task_status_signal(text) cascade;
drop function if exists public.inbox_items_prevent_raw_content_update() cascade;
drop function if exists public.normalize_text(text) cascade;

drop table if exists public.assertion_entities cascade;
drop table if exists public.event_entities cascade;
drop table if exists public.entity_alias_evidences cascade;
drop table if exists public.inbox_item_entities cascade;
drop table if exists public.entity_resolution_logs cascade;
drop table if exists public.clarification_requests cascade;
drop table if exists public.task_mutations cascade;
drop table if exists public.tasks cascade;
drop table if exists public.assertions cascade;
drop table if exists public.events cascade;
drop table if exists public.entity_aliases cascade;
drop table if exists public.entities cascade;
drop table if exists public.inbox_extraction_runs cascade;
drop table if exists public.corrections cascade;
drop table if exists public.inbox_items cascade;
drop table if exists public.policies cascade;
`;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

function resolveDatabaseHost(supabaseUrl: string, databaseUrl?: string): string {
  if (databaseUrl?.trim()) {
    try {
      return new URL(databaseUrl.trim()).hostname;
    } catch {
      fail('DATABASE_URL inválida — não foi possível extrair hostname.');
    }
  }
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `db.${ref}.supabase.co`;
}

function buildDatabaseUrl(supabaseUrl: string): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) {
    fail(
      'Defina SUPABASE_DB_PASSWORD ou DATABASE_URL.\n' +
        '  Senha: Supabase → Settings → Database → Database password',
    );
  }

  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

function printDestructiveTargetBanner(input: {
  supabaseUrl: string;
  apiHost: string;
  databaseHost: string;
  databaseName: string;
}): void {
  console.log('\n⚠️  OPERAÇÃO DESTRUTIVA — schema greenfield v2');
  console.log('   Todas as tabelas do schema public serão DROPADAS e recriadas.');
  console.log('   NÃO use em produção. Faça backup se necessário.\n');
  console.log(`   SUPABASE_URL:  ${input.supabaseUrl}`);
  console.log(`   API host:      ${input.apiHost}`);
  console.log(`   Database host: ${input.databaseHost}`);
  console.log(`   Database:      ${input.databaseName}\n`);
}

async function main(): Promise<void> {
  if (process.env.ALLOW_GREENFIELD_SCHEMA_APPLY !== 'true') {
    fail('Defina ALLOW_GREENFIELD_SCHEMA_APPLY=true para aplicar schema greenfield (destructivo).');
  }

  const confirmHost = process.env.GREENFIELD_SCHEMA_APPLY_CONFIRM?.trim();
  if (!confirmHost) {
    fail(
      'Defina GREENFIELD_SCHEMA_APPLY_CONFIRM=<hostname> para confirmar o banco alvo.\n' +
        '  Ex.: GREENFIELD_SCHEMA_APPLY_CONFIRM=abcdefghijklmnop.supabase.co\n' +
        '  Ou o host Postgres: db.abcdefghijklmnop.supabase.co',
    );
  }

  const env = loadEnv({
    GREENFIELD_SCHEMA: 'false',
    EXTRACTOR_V14_SHADOW_ENABLED: 'false',
    PERSIST_COMPILED_MEMORY_V2: 'false',
  });
  const blocked = isBlockedProductionTarget(env.SUPABASE_URL, env.NODE_ENV);
  if (blocked) fail(blocked);

  const apiHost = new URL(env.SUPABASE_URL).hostname;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const databaseHost = resolveDatabaseHost(env.SUPABASE_URL, databaseUrl);
  const allowedHosts = new Set([apiHost, databaseHost]);
  if (!allowedHosts.has(confirmHost)) {
    fail(
      `GREENFIELD_SCHEMA_APPLY_CONFIRM="${confirmHost}" não corresponde ao alvo.\n` +
        `  Esperado um de: ${[...allowedHosts].join(', ')}`,
    );
  }

  printDestructiveTargetBanner({
    supabaseUrl: env.SUPABASE_URL,
    apiHost,
    databaseHost,
    databaseName: 'postgres',
  });

  console.log('=== Aplicar schema greenfield v2 ===\n');

  const connectionString = buildDatabaseUrl(env.SUPABASE_URL);
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    ok('Conectado ao Postgres');
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

  try {
    console.log('\n→ Drop objetos anteriores ...');
    await client.query(DROP_GREENFIELD_OBJECTS);
    ok('Objetos anteriores removidos');

    for (const file of MIGRATIONS) {
      const path = join(migrationsDir, file);
      const sql = readFileSync(path, 'utf8');
      console.log(`\n→ ${file} ...`);
      await client.query(sql);
      ok(MIGRATION_LABELS[file]);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end();
  }

  console.log('\nOrdem aplicada (idempotente via drop + recreate):');
  console.log('  1. 20260602100000_greenfield_baseline.sql');
  console.log('  2. 20260602100001_greenfield_rpcs.sql');
  console.log('  3. 20260602100002_greenfield_seeds.sql');
  console.log('  4. 20260603120000_s1_simplify_promote_blocking_scope.sql');
  console.log('  5. 20260603130000_s2_external_action_no_promote_block.sql');
  console.log('  6. 20260604000000_persist_extraction_candidates.sql');
  console.log('\nSchema greenfield aplicado. Rode: npm run verify:env\n');
  console.log(
    'Deploy incremental (sem drop): SUPABASE_DB_PASSWORD=... npm run db:apply-incremental-migrations\n',
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
