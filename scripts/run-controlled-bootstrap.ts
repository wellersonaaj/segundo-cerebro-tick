/**
 * S3 — Bootstrap controlado em homologação.
 *
 * Pré-requisitos:
 *   npm run dev
 *   verify:env verde
 *   ALLOW_TEST_DATA_RESET=true npm run reset:test-data   (opcional, estado limpo)
 *
 * Uso:
 *   ALLOW_CONTROLLED_BOOTSTRAP=true npm run bootstrap:controlled
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { fail, fetchJson, loadHomologEnv, ok, requireEnv } from './lib/homolog-helpers.js';
import {
  isMvpBlockedGenericEntityTerm,
  MVP_BLOCKED_GENERIC_ENTITY_TERMS,
} from '../src/config/mvp-registry-policy.js';

loadDotEnv();

const FIXTURES_PATH = join(process.cwd(), 'data/bootstrap/s3-controlled-fixtures.json');
const REPORT_PATH = join(process.cwd(), 'artifacts/bootstrap/s3-controlled-bootstrap-report.json');

interface FixtureEntry {
  id: string;
  label: string;
  raw_content: string;
  correction?: { text: string };
}

interface FixturesFile {
  defaults: {
    source_channel: string;
    source_mode: string;
    received_at: string;
    timezone: string;
  };
  entries: FixtureEntry[];
  probes: {
    external_action_unsafe: { label: string; raw_content: string };
  };
}

interface InboxSnapshot {
  fixture_id: string;
  label: string;
  raw_content: string;
  inbox_item_id: string;
  post_response: Record<string, unknown>;
  processing_status: string | null;
  raw_content_preserved: boolean;
  runs: unknown[];
  entities_active: unknown[];
  events: unknown[];
  assertions: unknown[];
  tasks: unknown[];
  clarifications: unknown[];
  processing_notes: string[];
  correction?: {
    correction_id: string;
    post_status: number;
    runs_after: unknown[];
    iie: unknown[];
    events: unknown[];
  };
}

function readFixtures(): FixturesFile {
  return JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as FixturesFile;
}

async function snapshotInbox(
  supabase: SupabaseClient,
  inboxId: string,
): Promise<Omit<InboxSnapshot, 'fixture_id' | 'label' | 'raw_content' | 'post_response' | 'raw_content_preserved'>> {
  const { data: inbox } = await supabase
    .from('inbox_items')
    .select('processing_status, raw_content')
    .eq('id', inboxId)
    .single();

  const { data: runs } = await supabase
    .from('inbox_extraction_runs')
    .select('id, status, trigger_type, promoted_at, extractor_version')
    .eq('inbox_item_id', inboxId)
    .order('created_at');

  const { data: iie } = await supabase
    .from('inbox_item_entities')
    .select('record_status, entities(name, entity_type, registry_status)')
    .eq('inbox_item_id', inboxId)
    .eq('record_status', 'active');

  const { data: events } = await supabase
    .from('events')
    .select('title, event_kind, record_status, source_excerpt')
    .eq('inbox_item_id', inboxId);

  const { data: assertions } = await supabase
    .from('assertions')
    .select('assertion_kind, subject_reference, predicate, value_text, record_status, is_current')
    .eq('inbox_item_id', inboxId);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, status, due_at_literal, due_at_local_date')
    .eq('inbox_item_id', inboxId);

  const { data: clarifications } = await supabase
    .from('clarification_requests')
    .select(
      'issue_type, blocking_scope, materiality, status, target_reference, target_type, record_status',
    )
    .eq('inbox_item_id', inboxId);

  const latestRun = runs?.[runs.length - 1];
  let processing_notes: string[] = [];
  if (latestRun?.id) {
    const { data: runRow } = await supabase
      .from('inbox_extraction_runs')
      .select('parsed_output')
      .eq('id', latestRun.id)
      .maybeSingle();
    const parsed = runRow?.parsed_output as { processing_notes?: string[] } | null;
    processing_notes = parsed?.processing_notes ?? [];
  }

  return {
    processing_status: inbox?.processing_status ?? null,
    runs: runs ?? [],
    entities_active: iie ?? [],
    events: events ?? [],
    assertions: assertions ?? [],
    tasks: tasks ?? [],
    clarifications: clarifications ?? [],
    processing_notes,
  };
}

async function ingestEntry(
  fixtures: FixturesFile,
  entry: FixtureEntry,
  supabase: SupabaseClient,
): Promise<InboxSnapshot> {
  const body = {
    raw_content: entry.raw_content,
    source_channel: fixtures.defaults.source_channel,
    source_mode: fixtures.defaults.source_mode,
    received_at: fixtures.defaults.received_at,
    timezone: fixtures.defaults.timezone,
  };

  const post = await fetchJson('/inbox-items', { method: 'POST', body: JSON.stringify(body) });
  if (post.status !== 201) {
    fail(`POST /inbox-items [${entry.id}] retornou ${post.status}: ${JSON.stringify(post.body)}`);
  }

  const postBody = post.body as Record<string, unknown>;
  const inboxId = postBody.inbox_item_id as string;
  if (!inboxId) fail(`Resposta sem inbox_item_id para ${entry.id}`);

  ok(`[${entry.id}] inbox_item ${inboxId} — processing_status=${postBody.processing_status}`);

  const snap = await snapshotInbox(supabase, inboxId);
  const get = await fetchJson(`/inbox-items/${inboxId}`);
  const rawAfter = (get.body as { raw_content: string }).raw_content;

  const result: InboxSnapshot = {
    fixture_id: entry.id,
    label: entry.label,
    raw_content: entry.raw_content,
    inbox_item_id: inboxId,
    post_response: postBody,
    raw_content_preserved: rawAfter === entry.raw_content,
    ...snap,
  };

  if (entry.correction) {
    const corr = await fetchJson(`/inbox-items/${inboxId}/corrections`, {
      method: 'POST',
      body: JSON.stringify({ correction_text: entry.correction.text }),
    });
    if (corr.status !== 201) {
      fail(
        `POST corrections [${entry.id}] retornou ${corr.status}: ${JSON.stringify(corr.body)}`,
      );
    }
    const corrBody = corr.body as { correction_id?: string };
    const after = await snapshotInbox(supabase, inboxId);
    const { data: iieAll } = await supabase
      .from('inbox_item_entities')
      .select('record_status, entities(name, entity_type)')
      .eq('inbox_item_id', inboxId);
    result.correction = {
      correction_id: corrBody.correction_id ?? '',
      post_status: corr.status,
      runs_after: after.runs,
      iie: iieAll ?? [],
      events: after.events,
    };
    ok(`[${entry.id}] correção aplicada — ${corrBody.correction_id}`);
  }

  return result;
}

async function probeExternalActionBlocked(fixtures: FixturesFile): Promise<{
  blocked: boolean;
  inbox_item_id?: string;
  error?: string;
}> {
  const probe = fixtures.probes.external_action_unsafe;
  const post = await fetchJson('/inbox-items', {
    method: 'POST',
    body: JSON.stringify({
      raw_content: probe.raw_content,
      source_channel: `${fixtures.defaults.source_channel}-probe`,
      source_mode: fixtures.defaults.source_mode,
      received_at: fixtures.defaults.received_at,
      timezone: fixtures.defaults.timezone,
    }),
  });

  if (post.status === 201) {
    const body = post.body as { inbox_item_id: string; processing_status: string };
    return {
      blocked: false,
      inbox_item_id: body.inbox_item_id,
      error: `promote concluiu com status=${body.processing_status}`,
    };
  }

  const err = (post.body as { error?: string })?.error ?? '';
  const blocked =
    post.status === 500 &&
    (err.includes('BLOCKING_CLARIFICATIONS') || err.includes('external_action'));
  return { blocked, error: err || String(post.status) };
}

async function runBasicQueries(snapshots: InboxSnapshot[]): Promise<Record<string, unknown>> {
  const entities = await fetchJson('/entities?limit=50');
  const tasks = await fetchJson('/tasks?status=open');
  const clarifications = await fetchJson('/clarifications?status=pending');
  const veltSearch = await fetchJson(`/memory/search?q=${encodeURIComponent('VELT')}`);

  const correctionInbox = snapshots.find((s) => s.fixture_id === 's3-10-correction-original');
  let correctionHistory: unknown = null;
  if (correctionInbox) {
    correctionHistory = {
      inbox: await fetchJson(`/inbox-items/${correctionInbox.inbox_item_id}`),
      runs: await fetchJson(`/inbox-items/${correctionInbox.inbox_item_id}/runs`),
      entities: await fetchJson(`/inbox-items/${correctionInbox.inbox_item_id}/entities`),
    };
  }

  return {
    entities_list: entities,
    tasks_open: tasks,
    clarifications_pending: clarifications,
    memory_search_velt: veltSearch,
    correction_history: correctionHistory,
  };
}

function validateS31Regression(snapshots: InboxSnapshot[]): void {
  const blockedNorms = new Set(MVP_BLOCKED_GENERIC_ENTITY_TERMS.map((t) => t.toLowerCase()));

  const allActiveNames: string[] = [];
  for (const snap of snapshots) {
    for (const row of snap.entities_active as Array<{ entities?: { name?: string } }>) {
      const name = row.entities?.name;
      if (name) allActiveNames.push(name);
    }
  }

  const promotedBlocked = allActiveNames.filter((n) => isMvpBlockedGenericEntityTerm(n));
  if (promotedBlocked.length > 0) {
    fail(`S3.1: termos genéricos promovidos: ${promotedBlocked.join(', ')}`);
  }
  ok('S3.1: termos genéricos/metalinguísticos não promovidos');

  const mustInclude: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /wellerson/i, label: 'Wellerson Assumpção' },
    { pattern: /bruno/i, label: 'Bruno Brant' },
    { pattern: /^VELT$/i, label: 'VELT' },
    { pattern: /segundo c[eé]rebro/i, label: 'Segundo Cérebro' },
    { pattern: /genius hotels/i, label: 'Genius Hotels' },
  ];
  for (const req of mustInclude) {
    if (!allActiveNames.some((n) => req.pattern.test(n))) {
      fail(`S3.1: entidade esperada ausente: ${req.label} (ativas: ${allActiveNames.join(', ')})`);
    }
  }
  ok('S3.1: entidades nucleus presentes');

  const decisionSnap = snapshots.find((s) => s.fixture_id === 's3-06-decision');
  if (decisionSnap) {
    const decisionEntities = (decisionSnap.entities_active as Array<{ entities?: { name?: string } }>)
      .map((r) => r.entities?.name ?? '')
      .filter(Boolean);
    const literalTypes = decisionEntities.filter((n) => blockedNorms.has(n.toLowerCase()));
    if (literalTypes.length > 0) {
      fail(`S3.1: s3-06 promoveu tipos literais: ${literalTypes.join(', ')}`);
    }
    ok('S3.1: s3-06 decisão sem tipos literais promovidos');
  }
}

function printEnvState(): Record<string, string | boolean> {
  const flags = {
    GREENFIELD_SCHEMA: process.env.GREENFIELD_SCHEMA === 'true',
    EXTRACTOR_V14_SHADOW_ENABLED: process.env.EXTRACTOR_V14_SHADOW_ENABLED === 'true',
    PERSIST_COMPILED_MEMORY_V2: process.env.PERSIST_COMPILED_MEMORY_V2 === 'true',
    SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  };
  console.log('\n--- Flags homologação ---');
  for (const [k, v] of Object.entries(flags)) {
    console.log(`  ${k}: ${v}`);
  }
  return flags;
}

async function main(): Promise<void> {
  if (process.env.ALLOW_CONTROLLED_BOOTSTRAP !== 'true') {
    fail('Defina ALLOW_CONTROLLED_BOOTSTRAP=true para executar bootstrap controlado S3.');
  }

  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']);

  console.log('\n=== S3 — Bootstrap controlado ===\n');

  const health = await fetchJson('/health', undefined, 15_000);
  if (health.status !== 200) {
    fail(`GET /health retornou ${health.status}. Rode npm run dev.`);
  }
  ok('GET /health');

  const envFlags = printEnvState();
  const env = loadHomologEnv();
  const fixtures = readFixtures();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const snapshots: InboxSnapshot[] = [];
  for (const entry of fixtures.entries) {
    console.log(`\n--- ${entry.id}: ${entry.label} ---`);
    snapshots.push(await ingestEntry(fixtures, entry, supabase));
  }

  console.log('\n--- Probe: external_action insegura ---');
  const externalProbe = await probeExternalActionBlocked(fixtures);
  if (!externalProbe.blocked) {
    console.warn(
      `⚠ E2E probe: promote concluiu (${externalProbe.error ?? 'sem erro'}) — LLM pode não ter emitido external_action nesta frase.`,
    );
    console.warn(
      '  Bloqueio RPC external_action confirmado separadamente por npm run verify:env.',
    );
  } else {
    ok('external_action insegura bloqueou promote (E2E)');
  }

  console.log('\n--- Consultas básicas ---');
  const queries = await runBasicQueries(snapshots);

  const genericTask = snapshots.find((s) => s.fixture_id === 's3-09-task-generic-target');
  const hasMissingTarget = (genericTask?.clarifications ?? []).some(
    (c) =>
      (c as { issue_type?: string }).issue_type === 'missing_task_target' &&
      (c as { status?: string }).status === 'pending',
  );
  if (!hasMissingTarget) {
    console.warn('⚠ s3-09: missing_task_target pending não encontrado no snapshot DB (verificar CM/v2)');
  } else {
    ok('s3-09: missing_task_target pending presente');
  }

  const correction = snapshots.find((s) => s.fixture_id === 's3-10-correction-original');
  if (correction?.correction) {
    const iie = correction.correction.iie as Array<{
      record_status: string;
      entities: { name: string } | null;
    }>;
    const marceloActive = iie.filter(
      (r) => r.record_status === 'active' && /marcelo/i.test(r.entities?.name ?? ''),
    );
    const brunoActive = iie.filter(
      (r) => r.record_status === 'active' && /bruno/i.test(r.entities?.name ?? ''),
    );
    if (marceloActive.length > 0) {
      fail(`Correção: Marcelo ainda active: ${JSON.stringify(marceloActive)}`);
    }
    if (brunoActive.length < 1) {
      fail(`Correção: Bruno active ausente: ${JSON.stringify(iie)}`);
    }
    ok('Correção simples: Marcelo superseded, Bruno active');
  }

  validateS31Regression(snapshots);

  mkdirSync(join(process.cwd(), 'artifacts/bootstrap'), { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    env_flags: envFlags,
    fixtures_path: FIXTURES_PATH,
    entries: snapshots,
    external_action_probe: externalProbe,
    basic_queries: queries,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  ok(`Relatório: ${REPORT_PATH}`);

  console.log('\n=== Bootstrap controlado S3 concluído ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
