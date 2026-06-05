/**
 * Arquiva inbox items e dismiss clarificações da sessão de teste do orchestrator.
 * Idempotente — pode rodar várias vezes.
 *
 *   npx tsx scripts/cleanup-test-artifacts.ts
 *   npx tsx scripts/cleanup-test-artifacts.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { withTelegramClarificationState } from '../src/telegram/telegram-metadata.js';

loadDotEnv();

/** Inbox items criados na sessão de teste (msgs 151, 153, 156, 159). */
export const DEFAULT_TEST_INBOX_IDS = [
  '5cea6edb-c248-4987-8f1a-8ed2fe029a66',
  'd49981dd-513b-4dce-bec6-c0b2f622e7ae',
  '4e0ce05a-a739-47ea-8380-45e279d028c5',
  'd78c2bb9-1a9e-4e87-b4f5-7ee2070bebab',
] as const;

/** Clarificações pendentes geradas na mesma sessão. */
export const DEFAULT_TEST_CLARIFICATION_IDS = [
  'f91c8f01-6f52-40a1-a4b5-cc1a2613b29e',
  'a0fde106-abb8-4b81-bbaf-4b9754049f24',
  'b0fb1cb9-7903-4d8d-b93b-766ecf447aad',
  'a2d7044a-637c-43cd-94f0-fd3bfcc34d2d',
] as const;

const ARCHIVE_REASON = 'orchestrator_test_session_cleanup';
const DISMISS_REASON_SUFFIX = ' [dismissed: parent_archived]';

async function dismissPendingForInbox(
  db: ReturnType<typeof createClient>,
  inboxId: string,
  dryRun: boolean,
): Promise<number> {
  const { data: pending, error } = await db
    .from('clarification_requests')
    .select('id, status, reason')
    .eq('inbox_item_id', inboxId)
    .eq('status', 'pending');
  if (error) throw new Error(`clarification list for inbox ${inboxId}: ${error.message}`);
  if (!pending?.length) return 0;

  for (const row of pending) {
    console.log(`${dryRun ? '→' : '✓'} clarification ${row.id} — dismiss (parent_archived)`);
  }

  if (dryRun || !pending.length) return pending.length;

  const now = new Date().toISOString();
  for (const row of pending) {
    const reason = `${String(row.reason ?? '')}${DISMISS_REASON_SUFFIX}`.trim();
    const { error: updErr } = await db
      .from('clarification_requests')
      .update({ status: 'dismissed', reason, updated_at: now })
      .eq('id', row.id)
      .eq('status', 'pending');
    if (updErr) throw new Error(`clarification dismiss ${row.id}: ${updErr.message}`);
  }
  return pending.length;
}

function parseIds(envKey: string, fallback: readonly string[]): string[] {
  const raw = process.env[envKey]?.trim();
  if (!raw) return [...fallback];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const inboxIds = parseIds('CLEANUP_INBOX_IDS', DEFAULT_TEST_INBOX_IDS);
  const clarificationIds = parseIds('CLEANUP_CLARIFICATION_IDS', DEFAULT_TEST_CLARIFICATION_IDS);

  console.log(`=== cleanup-test-artifacts ${dryRun ? '(dry-run)' : ''} ===\n`);
  console.log(`Inbox items: ${inboxIds.length}`);
  console.log(`Clarifications: ${clarificationIds.length}\n`);

  for (const id of inboxIds) {
    const { data: row, error } = await db.from('inbox_items').select('id, metadata, raw_content').eq('id', id).maybeSingle();
    if (error) throw new Error(`inbox fetch ${id}: ${error.message}`);
    if (!row) {
      console.log(`⊘ inbox ${id} — não encontrado (skip)`);
      continue;
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (meta.archived === true && meta.archived_reason === ARCHIVE_REASON) {
      console.log(`✓ inbox ${id} — já arquivado`);
      await dismissPendingForInbox(db, id, dryRun);
      continue;
    }

    const excerpt = String(row.raw_content ?? '').slice(0, 60);
    console.log(`${dryRun ? '→' : '✓'} inbox ${id} — arquivar "${excerpt}"`);

    if (!dryRun) {
      const nextMeta = {
        ...withTelegramClarificationState(meta, null),
        archived: true,
        archived_at: new Date().toISOString(),
        archived_reason: ARCHIVE_REASON,
      };
      const { error: updErr } = await db.from('inbox_items').update({ metadata: nextMeta }).eq('id', id);
      if (updErr) throw new Error(`inbox archive ${id}: ${updErr.message}`);
      await dismissPendingForInbox(db, id, dryRun);
    } else {
      await dismissPendingForInbox(db, id, dryRun);
    }
  }

  for (const id of clarificationIds) {
    const { data: row, error } = await db
      .from('clarification_requests')
      .select('id, status, question')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`clarification fetch ${id}: ${error.message}`);
    if (!row) {
      console.log(`⊘ clarification ${id} — não encontrada (skip)`);
      continue;
    }

    if (row.status === 'dismissed') {
      console.log(`✓ clarification ${id} — já dismissed`);
      continue;
    }

    if (row.status !== 'pending') {
      console.log(`⊘ clarification ${id} — status=${row.status} (skip)`);
      continue;
    }

    console.log(`${dryRun ? '→' : '✓'} clarification ${id} — dismiss`);

    if (!dryRun) {
      const { error: updErr } = await db
        .from('clarification_requests')
        .update({ status: 'dismissed', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (updErr) throw new Error(`clarification dismiss ${id}: ${updErr.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
