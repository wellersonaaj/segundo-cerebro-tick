/**
 * Reprocess one or more inbox items and print before/after.
 *
 *   npx tsx scripts/reprocess-inbox-items.ts b7419f66-... a540c0c9-...
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { ReprocessService } from '../src/services/correction.service.js';

loadDotEnv();

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Usage: npx tsx scripts/reprocess-inbox-items.ts <inbox_item_id> [...]');
  process.exit(1);
}

function buildDatabaseUrl(supabaseUrl: string): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) throw new Error('Defina SUPABASE_DB_PASSWORD ou DATABASE_URL');
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('OPENAI_API_KEY obrigatória');
    process.exit(1);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const pgClient = new pg.Client({
    connectionString: buildDatabaseUrl(env.SUPABASE_URL),
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  const reprocess = new ReprocessService(supabase);

  for (const id of ids) {
    console.log(`\n${'='.repeat(60)}\n${id}\n${'='.repeat(60)}`);

    const before = await pgClient.query(
      `SELECT id, processing_status, processing_error, left(raw_content, 150) AS raw_excerpt,
              created_at, processed_at
       FROM inbox_items WHERE id = $1::uuid`,
      [id],
    );
    console.log('\nANTES:', JSON.stringify(before.rows[0], null, 2));

    const failedRuns = await pgClient.query(
      `SELECT id::text, status, trigger_type, error_message, started_at
       FROM inbox_extraction_runs
       WHERE inbox_item_id = $1::uuid AND status = 'failed'
       ORDER BY started_at DESC LIMIT 3`,
      [id],
    );
    console.log('\nRuns failed (histórico):', JSON.stringify(failedRuns.rows, null, 2));

    try {
      const result = await reprocess.reprocess(id);
      console.log('\nREPROCESS:', JSON.stringify(result, null, 2));
    } catch (err) {
      console.log('\nREPROCESS ERRO:', err instanceof Error ? err.message : String(err));
    }

    const after = await pgClient.query(
      `SELECT processing_status, processing_error, active_extraction_run_id::text,
              latest_extraction_run_id::text, processed_at
       FROM inbox_items WHERE id = $1::uuid`,
      [id],
    );
    console.log('\nDEPOIS:', JSON.stringify(after.rows[0], null, 2));

    const lastRun = await pgClient.query(
      `SELECT id::text, status, trigger_type, error_message, started_at, finished_at, promoted_at
       FROM inbox_extraction_runs
       WHERE inbox_item_id = $1::uuid
       ORDER BY started_at DESC LIMIT 1`,
      [id],
    );
    console.log('\nÚltimo run:', JSON.stringify(lastRun.rows[0], null, 2));
  }

  await pgClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
