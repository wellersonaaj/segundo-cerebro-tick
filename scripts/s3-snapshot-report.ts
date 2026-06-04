/**
 * Gera relatório S3 a partir dos inbox_items já ingeridos (controlled-bootstrap-s3).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { fetchJson } from './lib/homolog-helpers.js';

loadDotEnv();
loadEnv();

const REPORT_PATH = join(process.cwd(), 'artifacts/bootstrap/s3-controlled-bootstrap-report.json');

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: items } = await sb
    .from('inbox_items')
    .select('id, raw_content, processing_status, source_channel, created_at')
    .or('source_channel.eq.controlled-bootstrap-s3,source_channel.ilike.%probe%')
    .order('created_at');

  const entries = [];
  for (const item of items ?? []) {
    const id = item.id;
    const { data: runs } = await sb
      .from('inbox_extraction_runs')
      .select('id, status, trigger_type, promoted_at, extractor_version')
      .eq('inbox_item_id', id)
      .order('created_at');
    const { data: iieActive } = await sb
      .from('inbox_item_entities')
      .select('record_status, entities(name, entity_type, registry_status)')
      .eq('inbox_item_id', id)
      .eq('record_status', 'active');
    const { data: iieAll } = await sb
      .from('inbox_item_entities')
      .select('record_status, entities(name, entity_type)')
      .eq('inbox_item_id', id);
    const { data: events } = await sb
      .from('events')
      .select('title, event_kind, record_status, source_excerpt')
      .eq('inbox_item_id', id);
    const { data: assertions } = await sb
      .from('assertions')
      .select('assertion_kind, subject_reference, predicate, value_text, record_status, is_current')
      .eq('inbox_item_id', id);
    const { data: tasks } = await sb
      .from('tasks')
      .select('title, status, due_at_literal, due_at_local_date')
      .eq('inbox_item_id', id);
    const { data: clarifications } = await sb
      .from('clarification_requests')
      .select('issue_type, blocking_scope, materiality, status, target_reference, record_status')
      .eq('inbox_item_id', id);

    entries.push({
      inbox_item_id: id,
      source_channel: item.source_channel,
      raw_content: item.raw_content,
      processing_status: item.processing_status,
      runs: runs ?? [],
      entities_active: iieActive ?? [],
      entities_all: iieAll ?? [],
      events: events ?? [],
      assertions: assertions ?? [],
      tasks: tasks ?? [],
      clarifications: clarifications ?? [],
    });
  }

  const correctionItem = entries.find((e) =>
    e.raw_content.includes('Marcelo Oliveira participou'),
  );

  const queries = {
    entities_list: await fetchJson('/entities?limit=50'),
    tasks_open: await fetchJson('/tasks?status=open'),
    clarifications_pending: await fetchJson('/clarifications?status=pending'),
    memory_search_velt: await fetchJson(`/memory/search?q=${encodeURIComponent('VELT')}`),
    correction_history: correctionItem
      ? {
          inbox: await fetchJson(`/inbox-items/${correctionItem.inbox_item_id}`),
          runs: await fetchJson(`/inbox-items/${correctionItem.inbox_item_id}/runs`),
          entities: await fetchJson(`/inbox-items/${correctionItem.inbox_item_id}/entities`),
        }
      : null,
  };

  const probe = entries.find((e) => e.source_channel?.includes('probe'));

  mkdirSync(join(process.cwd(), 'artifacts/bootstrap'), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        entries,
        external_action_probe: probe
          ? {
              inbox_item_id: probe.inbox_item_id,
              processing_status: probe.processing_status,
              clarifications: probe.clarifications,
              note:
                probe.processing_status === 'completed'
                  ? 'E2E: LLM não emitiu external_action blocking nesta frase; RPC bloqueia (verify:env OK)'
                  : 'E2E: promote bloqueado',
            }
          : null,
        basic_queries: queries,
      },
      null,
      2,
    ),
  );
  console.log(`Relatório: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
