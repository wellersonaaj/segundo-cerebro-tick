/**
 * Aplica migrations SQL pendentes (011–014) via conexão Postgres direta.
 *
 * A SUPABASE_SERVICE_ROLE_KEY do .env NÃO serve para DDL — use a senha do banco:
 * Supabase Dashboard → Settings → Database → Database password
 *
 *   SUPABASE_DB_PASSWORD='...' npm run db:apply-migrations
 *
 * Ou DATABASE_URL completa:
 *   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' npm run db:apply-migrations
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

const MIGRATIONS = [
  '011_reconcile_extraction_runs_and_lineage.sql',
  '012_registry_lifecycle_and_alias_evidences.sql',
  '013_extraction_run_rpcs.sql',
  '014_backfill_and_enforce_not_null.sql',
] as const;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) {
    fail(
      'Defina SUPABASE_DB_PASSWORD ou DATABASE_URL.\n' +
        '  Senha: Supabase → Settings → Database → Database password\n' +
        '  (diferente da SUPABASE_SERVICE_ROLE_KEY no .env)',
    );
  }

  const env = loadEnv();
  const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main(): Promise<void> {
  if (process.env.LEGACY_MIGRATIONS !== 'true') {
    fail(
      'Migrations 011–014 legadas descontinuadas. Use:\n' +
        '  ALLOW_GREENFIELD_SCHEMA_APPLY=true npm run db:apply-greenfield-schema',
    );
  }

  console.log('\n=== Aplicar migrations 011–014 (LEGACY) ===\n');

  const connectionString = buildDatabaseUrl();
  // Supabase pooler/direct host uses a chain that often fails Node strict verify.
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    ok('Conectado ao Postgres');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('password authentication failed')) {
      fail(
        'Autenticação falhou. Verifique SUPABASE_DB_PASSWORD (senha do banco, não a service role key).',
      );
    }
    fail(`Conexão falhou: ${msg}`);
  }

  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

  try {
    for (const file of MIGRATIONS) {
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

  console.log('\nMigrations 011–014 aplicadas. Rode: npm run verify:env\n');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
