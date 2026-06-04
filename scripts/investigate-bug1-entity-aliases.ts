/**
 * Bloco 1 — investigar Bug 1 (entity_aliases.updated_at)
 * Uso: SUPABASE_DB_PASSWORD=... npm run db:investigate-bug1
 */

import pg from 'pg';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

function buildDatabaseUrl(supabaseUrl: string): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) throw new Error('Defina SUPABASE_DB_PASSWORD ou DATABASE_URL');
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function runSection(label: string, sql: string, client: pg.Client): Promise<void> {
  console.log(`\n${'='.repeat(60)}\n${label}\n${'='.repeat(60)}`);
  try {
    const r = await client.query(sql);
    console.log(JSON.stringify(r.rows, null, 2));
    console.log(`(${r.rowCount} row(s))`);
  } catch (err) {
    console.error('ERROR:', err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: buildDatabaseUrl(env.SUPABASE_URL),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Conectado ao Postgres (homolog/prod do .env)\n');

  await runSection(
    '1A) set_updated_at prosrc',
    `SELECT proname, prosrc FROM pg_proc WHERE proname = 'set_updated_at'`,
    client,
  );

  await runSection(
    '1B) Funções que citam entity_aliases (qualquer schema)',
    `SELECT n.nspname AS schema, p.proname, obj_description(p.oid, 'pg_proc') AS comment
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND p.prosrc ILIKE '%entity_aliases%'
     ORDER BY n.nspname, p.proname`,
    client,
  );

  await runSection(
    '1C) Views / rules / policies em entity_aliases',
    `SELECT 'view' AS obj_type, schemaname || '.' || viewname AS name, left(definition, 500) AS source
     FROM pg_views
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       AND definition ILIKE '%entity_aliases%'
     UNION ALL
     SELECT 'rule', schemaname || '.' || tablename || '.' || rulename, definition
     FROM pg_rules WHERE tablename = 'entity_aliases'
     UNION ALL
     SELECT 'policy', schemaname || '.' || tablename || '.' || policyname, left(coalesce(qual, with_check), 500)
     FROM pg_policies WHERE tablename = 'entity_aliases'`,
    client,
  );

  await runSection(
    '1D) Triggers em entity_aliases',
    `SELECT t.tgname, c.relname AS table_name, (t.tgconstraint <> 0) AS is_constraint_trigger,
            left(p.prosrc, 500) AS trigger_fn
     FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid
     JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
       AND (p.prosrc ILIKE '%entity_aliases%' OR c.relname = 'entity_aliases')
     ORDER BY c.relname, t.tgname`,
    client,
  );

  await runSection(
    '1E) Event triggers',
    `SELECT evtname, evtenabled, pg_get_triggerdef(oid) AS def
     FROM pg_event_trigger ORDER BY evtname`,
    client,
  );

  await runSection(
    'Extra) Colunas entity_aliases',
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'entity_aliases'
     ORDER BY ordinal_position`,
    client,
  );

  await runSection(
    'Extra) Índices entity_aliases',
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'entity_aliases' ORDER BY indexname`,
    client,
  );

  await runSection(
    'Extra) persist prosrc menciona updated_at + entity_aliases?',
    `SELECT proname,
            prosrc ILIKE '%entity_aliases%updated_at%' AS bad_combo,
            prosrc ILIKE '%update%entity_aliases%' AS has_update_alias,
            strpos(prosrc, 'entity_aliases') AS pos_alias
     FROM pg_proc WHERE proname IN ('persist_extraction_candidates','fail_extraction_run','promote_extraction_run')`,
    client,
  );

  await runSection(
    'Extra) Tabelas com trigger set_updated_at',
    `SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS def
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE p.proname = 'set_updated_at' AND NOT t.tgisinternal
     ORDER BY c.relname`,
    client,
  );

  await runSection(
    'Extra) inbox_items com erro updated_at em entity_aliases',
    `SELECT id, processing_status, left(processing_error, 800) AS processing_error
     FROM inbox_items
     WHERE processing_error ILIKE '%entity_aliases%updated_at%'
        OR id::text LIKE '65125b5d%'
     ORDER BY created_at DESC LIMIT 5`,
    client,
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
