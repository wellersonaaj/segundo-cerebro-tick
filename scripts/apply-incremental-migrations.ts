/**
 * Aplica migrations incrementais greenfield (após baseline + RPCs + seeds).
 *
 * Fluxo padrão de deploy/homolog:
 *   1. npm run db:apply-greenfield-schema   (baseline + RPCs históricos + seeds)
 *   2. npm run db:apply-incremental-migrations
 *
 * Não substitui migrations — é o runner oficial para SQL incremental.
 *
 *   SUPABASE_DB_PASSWORD='...' npm run db:apply-incremental-migrations
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

const INCREMENTAL_MIGRATIONS = [
  '20260603120000_s1_simplify_promote_blocking_scope.sql',
  '20260603130000_s2_external_action_no_promote_block.sql',
  '20260604000001_persist_rpc_indexes.sql',
  '20260604000000_persist_extraction_candidates.sql',
] as const;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`);
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

async function main(): Promise<void> {
  console.log('\n=== Aplicar migrations incrementais greenfield ===\n');

  const env = loadEnv();
  const client = new pg.Client({
    connectionString: buildDatabaseUrl(env.SUPABASE_URL),
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
    for (const file of INCREMENTAL_MIGRATIONS) {
      const path = join(migrationsDir, file);
      const sql = readFileSync(path, 'utf8');
      console.log(`\n→ ${file} ...`);
      await client.query(sql);
      ok(`${file} aplicada`);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end();
  }

  console.log('\nMigrations incrementais aplicadas. Rode: npm run verify:env\n');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
