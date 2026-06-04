/**
 * Dump prosrc das RPCs greenfield para snapshot versionado.
 *   npm run db:dump-rpc-prosrc
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

const RPC_NAMES = [
  'persist_extraction_candidates',
  'promote_extraction_run',
  'fail_extraction_run',
] as const;

function buildDatabaseUrl(supabaseUrl: string): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) throw new Error('Defina SUPABASE_DB_PASSWORD ou DATABASE_URL');
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: buildDatabaseUrl(env.SUPABASE_URL),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const parts: string[] = [
    '-- Snapshot: prosrc das RPCs em homolog após migrations até 20260604130000',
    `-- Generated: ${new Date().toISOString()}`,
    '-- Não aplicar como migration; referência para 014+ e revisões OpenClaw.',
    '',
  ];

  for (const name of RPC_NAMES) {
    const r = await client.query(
      `SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosrc
       FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace AND proname = $1
       ORDER BY oid DESC LIMIT 1`,
      [name],
    );
    const row = r.rows[0] as { proname: string; args: string; prosrc: string } | undefined;
    if (!row) {
      parts.push(`-- MISSING: ${name}`, '');
      continue;
    }
    parts.push(
      `-- =============================================================================`,
      `-- ${row.proname}(${row.args})`,
      `-- =============================================================================`,
      row.prosrc.trimEnd(),
      '',
    );
  }

  await client.end();

  const outPath = join(process.cwd(), 'docs', 'rpc-prosrc-post-013-snapshot.sql');
  writeFileSync(outPath, `${parts.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${outPath} (${parts.join('\n').length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
