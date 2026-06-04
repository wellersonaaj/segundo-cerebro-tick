/**
 * OpenClaw pendentes: reprocess 65125b5d + teste 2A–2C (315a8800)
 *
 *   OPENAI_API_KEY=... SUPABASE_DB_PASSWORD=... npx tsx scripts/run-openclaw-pending-checks.ts
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { ReprocessService } from '../src/services/correction.service.js';

loadDotEnv();

const BUG1_INBOX_ID = '65125b5d-e718-4716-8c36-428164da3882';

function buildDatabaseUrl(supabaseUrl: string): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) throw new Error('Defina SUPABASE_DB_PASSWORD ou DATABASE_URL');
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function runAliasConflictTest(client: pg.Client): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const r2a = await client.query(`
    SELECT normalized_alias, entity_id::text, registry_status
    FROM entity_aliases
    WHERE registry_status IN ('active','candidate')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  out['2A'] = r2a.rows;
  if (r2a.rows.length === 0) {
    out['2B'] = { skipped: true, reason: 'no active/candidate alias' };
    out['2C'] = { skipped: true };
    return out;
  }

  const row = r2a.rows[0] as {
    normalized_alias: string;
    entity_id: string;
    registry_status: string;
  };

  const r2b = await client.query(
    `
    INSERT INTO entity_aliases (entity_id, alias, normalized_alias, registry_status, created_by_extraction_run_id)
    VALUES (
      (SELECT id FROM entities WHERE id <> $1::uuid ORDER BY random() LIMIT 1),
      'TEST_REPRO_315a8800_' || extract(epoch from now())::text,
      $2,
      'candidate',
      gen_random_uuid()
    )
    ON CONFLICT (normalized_alias) WHERE registry_status IN ('active','candidate')
    DO NOTHING
    RETURNING id::text, entity_id::text, normalized_alias, registry_status
    `,
    [row.entity_id, row.normalized_alias],
  );
  out['2B'] = {
    input: { normalized_alias: row.normalized_alias, existing_entity_id: row.entity_id },
    returned_rows: r2b.rows,
    row_count: r2b.rowCount,
    interpretation:
      r2b.rowCount === 0
        ? 'ON CONFLICT DO NOTHING — sem nova linha (esperado, índice OK)'
        : 'INSERT retornou linha — verificar se é a mesma entity ou conflito não aplicou',
  };

  try {
    const r2c = await client.query(
      `
      INSERT INTO entity_aliases (entity_id, alias, normalized_alias, registry_status, created_by_extraction_run_id)
      VALUES (
        (SELECT id FROM entities WHERE id <> $1::uuid ORDER BY random() LIMIT 1),
        'TEST_REPRO_315a8800_BARE_' || extract(epoch from now())::text,
        $2,
        'candidate',
        gen_random_uuid()
      )
      RETURNING id::text
      `,
      [row.entity_id, row.normalized_alias],
    );
    out['2C'] = {
      error: null,
      returned_rows: r2c.rows,
      interpretation: 'INSERT sem ON CONFLICT passou — índice NÃO bloqueou (inesperado)',
    };
    if (r2c.rows[0]?.id) {
      await client.query(`DELETE FROM entity_aliases WHERE id = $1::uuid`, [r2c.rows[0].id]);
      out['2C_cleanup'] = 'deleted test row from 2C';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out['2C'] = {
      error: msg,
      interpretation: msg.includes('duplicate key')
        ? 'Constraint bloqueou sem ON CONFLICT — índice OK; bug 315a8800 provavelmente outro caminho'
        : 'outro erro',
    };
  }

  return out;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('OPENAI_API_KEY obrigatória para reprocess');
    process.exit(1);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const pgClient = new pg.Client({
    connectionString: buildDatabaseUrl(env.SUPABASE_URL),
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  console.log('\n=== Bug 1 — estado antes do reprocess ===\n');
  const before = await pgClient.query(
    `SELECT id, processing_status, left(processing_error, 500) AS processing_error,
            left(raw_content, 200) AS raw_excerpt, created_at
     FROM inbox_items WHERE id = $1::uuid`,
    [BUG1_INBOX_ID],
  );
  console.log(JSON.stringify(before.rows, null, 2));

  console.log('\n=== Bug 1 — reprocess (pipeline v14 + OpenAI) ===\n');
  let reprocessResult: Record<string, unknown>;
  try {
    const reprocess = new ReprocessService(supabase);
    const result = await reprocess.reprocess(BUG1_INBOX_ID);
    reprocessResult = { ok: true, ...result };
  } catch (err) {
    reprocessResult = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  console.log(JSON.stringify(reprocessResult, null, 2));

  const after = await pgClient.query(
    `SELECT id, processing_status, left(processing_error, 800) AS processing_error,
            active_extraction_run_id::text, latest_extraction_run_id::text, processed_at
     FROM inbox_items WHERE id = $1::uuid`,
    [BUG1_INBOX_ID],
  );
  console.log('\n=== Bug 1 — estado após reprocess ===\n');
  console.log(JSON.stringify(after.rows, null, 2));

  const lastRun = await pgClient.query(
    `SELECT id::text, status, trigger_type, left(error_message, 500) AS error_message, started_at
     FROM inbox_extraction_runs
     WHERE inbox_item_id = $1::uuid
     ORDER BY started_at DESC LIMIT 3`,
    [BUG1_INBOX_ID],
  );
  console.log('\n=== Bug 1 — últimos runs ===\n');
  console.log(JSON.stringify(lastRun.rows, null, 2));

  console.log('\n=== Teste 315a8800 — 2A–2C ===\n');
  const aliasTest = await runAliasConflictTest(pgClient);
  console.log(JSON.stringify(aliasTest, null, 2));

  await pgClient.end();
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
