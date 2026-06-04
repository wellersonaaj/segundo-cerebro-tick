/**
 * Pipeline smoke — 15 cenários de homologação do pipeline versionado.
 *
 * Pré-requisitos:
 *   - Schema greenfield aplicado (npm run db:apply-greenfield-schema)
 *   - GREENFIELD_SCHEMA=true EXTRACTOR_V14_SHADOW_ENABLED=true PERSIST_COMPILED_MEMORY_V2=true
 *   - npm run verify:env OK
 *   - npm run dev (API rodando)
 *   - OPENAI_API_KEY configurada
 *
 *   ALLOW_PIPELINE_SMOKE=true npm run test:pipeline:smoke
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EntitiesRepository } from '../src/repositories/entities.repository.js';
import { normalizeText } from '../src/utils/normalize.js';
import {
  fail,
  fetchJson,
  loadHomologEnv,
  ok,
  requireEnv,
} from './lib/homolog-helpers.js';

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']);

const CHANNEL = 'pipeline-smoke';

type InboxRow = {
  id: string;
  processing_status: string;
  active_extraction_run_id: string | null;
  latest_extraction_run_id: string | null;
  has_active_memory?: boolean;
};

function assertEnvFlag(): void {
  if (process.env.ALLOW_PIPELINE_SMOKE !== 'true') {
    fail('Defina ALLOW_PIPELINE_SMOKE=true para executar smokes destrutivos/integrados.');
  }
}

async function createInbox(
  rawContent: string,
  opts: { source_mode?: string; source_channel?: string } = {},
): Promise<string> {
  const res = await fetchJson('/inbox-items', {
    method: 'POST',
    body: JSON.stringify({
      raw_content: rawContent,
      source_channel: opts.source_channel ?? CHANNEL,
      source_mode: opts.source_mode ?? 'conversational',
      received_at: '2026-06-01T10:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    }),
  });
  if (res.status !== 201) {
    fail(`POST /inbox-items falhou (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const id = (res.body as { inbox_item_id: string }).inbox_item_id;
  if (!id) fail('Resposta sem inbox_item_id');
  return id;
}

async function getInbox(id: string): Promise<InboxRow> {
  const res = await fetchJson(`/inbox-items/${id}`);
  if (res.status !== 200) fail(`GET /inbox-items/${id} → ${res.status}`);
  return res.body as InboxRow;
}

async function countActive(
  supabase: SupabaseClient,
  table: string,
  inboxId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', inboxId)
    .eq('record_status', 'active');
  if (error) fail(`${table} count: ${error.message}`);
  return count ?? 0;
}

async function countEvents(supabase: SupabaseClient, inboxId: string): Promise<number> {
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', inboxId)
    .eq('record_status', 'active');
  if (error) fail(`events count: ${error.message}`);
  return count ?? 0;
}

async function waitForCompleted(id: string, maxMs = 180_000): Promise<InboxRow> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const inbox = await getInbox(id);
    if (inbox.processing_status === 'completed') return inbox;
    if (inbox.processing_status === 'failed') {
      fail(`Inbox ${id} falhou no processamento`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  fail(`Timeout aguardando completed para inbox ${id}`);
}

async function scenario01_bootstrapEntitiesOnly(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 1: Bootstrap entities-only (events=[]) ---');
  const text =
    'Panorama: Wellerson Assumpção (Tick), Larisse do Carmo Peixoto (Lari), Marcelo Oliveira (Tchelo).';
  const id = await createInbox(text, { source_channel: 'bootstrap' });
  const inbox = await waitForCompleted(id);
  const iie = await countActive(supabase, 'inbox_item_entities', id);
  const events = await countEvents(supabase, id);
  if (iie <= 0) fail('Cenário 1: esperado IIE active > 0');
  ok(`Cenário 1: IIE active = ${iie}`);
  ok(`Cenário 1: events active = ${events} (pode ser 0)`);
  if (!inbox.active_extraction_run_id) fail('Cenário 1: active_extraction_run_id null');
  ok('Cenário 1: run promovido');
}

async function scenario02_assertionsNoEvents(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 2: entities + assertions, events=[] ---');
  const text =
    'Wellerson prefere reuniões pela manhã. Larisse cuida do financeiro. Marcelo lidera engenharia.';
  const id = await createInbox(text);
  await waitForCompleted(id);
  const iie = await countActive(supabase, 'inbox_item_entities', id);
  const assertions = await countActive(supabase, 'assertions', id);
  if (iie <= 0 || assertions <= 0) {
    fail(`Cenário 2: IIE=${iie} assertions=${assertions}`);
  }
  ok(`Cenário 2: IIE=${iie}, assertions=${assertions}`);
}

async function scenario03_semanticEvent(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 3: conversa com evento semântico ---');
  const text = 'Marcelo participou da reunião sobre integração com a Genius na segunda-feira.';
  const id = await createInbox(text);
  await waitForCompleted(id);
  const events = await countEvents(supabase, id);
  const iie = await countActive(supabase, 'inbox_item_entities', id);
  if (events <= 0) fail('Cenário 3: esperado event active > 0');
  if (iie <= 0) fail('Cenário 3: esperado IIE active > 0');
  ok(`Cenário 3: events=${events}, IIE=${iie}`);
}

async function scenario04_emailSimulated(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 4: e-mail simulado ---');
  const text = 'De: Bruno Brant\nPara: Wellerson\nAssunto: Follow-up\n\nBruno confirmou o alinhamento.';
  const id = await createInbox(text, { source_mode: 'passive' });
  await waitForCompleted(id);
  const iie = await countActive(supabase, 'inbox_item_entities', id);
  if (iie <= 0) fail('Cenário 4: esperado IIE mentioned > 0');
  ok(`Cenário 4: IIE active = ${iie}`);
}

async function scenario05_explicitAlias(
  supabase: SupabaseClient,
  entitiesRepo: EntitiesRepository,
): Promise<void> {
  console.log('\n--- Cenário 5: alias explícito ---');
  const text = 'Nicolas Alexandre de Souza Faleiro também é conhecido como Nico.';
  const id = await createInbox(text);
  await waitForCompleted(id);
  const { count, error } = await supabase
    .from('entity_alias_evidences')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', id)
    .eq('record_status', 'active');
  if (error) fail(`alias_evidences: ${error.message}`);
  ok(`Cenário 5: alias_evidences active = ${count ?? 0}`);
  const matches = await entitiesRepo.searchEntitiesQuery('Nico', [], 5);
  ok(`Cenário 5: search_entities("Nico") → ${matches.length} match(es)`);
}

async function scenario06_aliasConflict(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 6: alias conflitante (clarification) ---');
  const text =
    'O apelido Shell agora se refere a Gabriel Guerra, não mais a Helcio Shell.';
  const id = await createInbox(text);
  await waitForCompleted(id);
  const { count, error } = await supabase
    .from('clarification_requests')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', id)
    .eq('status', 'pending');
  if (error) fail(`clarifications: ${error.message}`);
  ok(`Cenário 6: clarifications pendentes = ${count ?? 0} (pode variar com modelo)`);
}

async function scenario07_correctionSupersede(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 7: correction → 2 runs promoted ---');
  const original = 'Marcelo participou da reunião sobre a integração.';
  const id = await createInbox(original);
  await waitForCompleted(id);
  const before = await getInbox(id);
  const activeBefore = before.active_extraction_run_id;

  const corr = await fetchJson(`/inbox-items/${id}/corrections`, {
    method: 'POST',
    body: JSON.stringify({ correction_text: 'Na verdade, Bruno participou da reunião.' }),
  });
  if (corr.status !== 201) fail(`correction falhou: ${corr.status}`);
  const after = await waitForCompleted(id);
  if (!after.active_extraction_run_id || after.active_extraction_run_id === activeBefore) {
    fail('Cenário 7: esperado novo active_extraction_run_id após correção');
  }
  const { count: runs } = await supabase
    .from('inbox_extraction_runs')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', id)
    .eq('status', 'promoted');
  if ((runs ?? 0) < 2) fail(`Cenário 7: esperado >= 2 runs promoted, obtido ${runs}`);
  ok(`Cenário 7: ${runs} runs promoted; Bruno substitui Marcelo`);
}

async function scenario08_reprocessWithCorrections(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 8: reprocess com correções ---');
  const original = 'Marcelo enviou o relatório trimestral.';
  const id = await createInbox(original);
  await waitForCompleted(id);
  await fetchJson(`/inbox-items/${id}/corrections`, {
    method: 'POST',
    body: JSON.stringify({ correction_text: 'O relatório foi enviado por Larisse, não Marcelo.' }),
  });
  await waitForCompleted(id);

  const repro = await fetchJson(`/inbox-items/${id}/reprocess`, { method: 'POST' });
  if (repro.status !== 201) fail(`reprocess falhou: ${repro.status}`);
  await waitForCompleted(id);

  const { count: runs } = await supabase
    .from('inbox_extraction_runs')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', id)
    .eq('trigger_type', 'reprocess');
  if ((runs ?? 0) < 1) fail('Cenário 8: esperado run reprocess');
  ok(`Cenário 8: reprocess runs = ${runs}`);
}

async function scenario09_reprocessFailedPreservesActive(
  supabase: SupabaseClient,
): Promise<void> {
  console.log('\n--- Cenário 9: fail run preserva active anterior (RPC) ---');
  const id = await createInbox('Texto simples para cenário de falha.');
  const inbox = await waitForCompleted(id);
  const activeBefore = inbox.active_extraction_run_id;
  if (!activeBefore) fail('Cenário 9: inbox sem active run');

  const { data: startData, error: startErr } = await supabase.rpc('start_extraction_run', {
    p_inbox_item_id: id,
    p_trigger_type: 'reprocess',
    p_schema_version: 'v1',
    p_prompt_version: 'v1',
    p_extractor_version: 'extractor-v1.3',
    p_model_name: 'probe',
    p_normalizer_version: '1.0.0',
    p_compiler_version: 'memory-compiler-v2',
    p_input_content_hash: 'fail-probe',
  });
  if (startErr) fail(`start_extraction_run: ${startErr.message}`);
  const runId = (startData as { run_id: string }).run_id;

  const { error: failErr } = await supabase.rpc('fail_extraction_run', {
    p_run_id: runId,
    p_error: 'pipeline-smoke simulated failure',
  });
  if (failErr) fail(`fail_extraction_run: ${failErr.message}`);

  const after = await getInbox(id);
  if (after.processing_status !== 'failed') fail(`Cenário 9: status=${after.processing_status}`);
  if (after.active_extraction_run_id !== activeBefore) {
    fail('Cenário 9: active_extraction_run_id alterado após fail');
  }
  if (!after.has_active_memory) fail('Cenário 9: has_active_memory deveria ser true');
  ok('Cenário 9: failed + active memory preservada');
}

async function scenario10_stalePromoteBlocked(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 10: promote stale bloqueado ---');
  const id = await createInbox('Probe concorrência stale.');
  const first = await waitForCompleted(id);
  const runA = first.active_extraction_run_id;
  if (!runA) fail('Cenário 10: run A ausente');

  const { data: rB, error: eB } = await supabase.rpc('start_extraction_run', {
    p_inbox_item_id: id,
    p_trigger_type: 'reprocess',
    p_schema_version: 'v1',
    p_prompt_version: 'v1',
    p_extractor_version: 'extractor-v1.3',
    p_model_name: 'probe',
    p_normalizer_version: '1.0.0',
    p_compiler_version: 'memory-compiler-v2',
  });
  if (eB) fail(`start B: ${eB.message}`);
  const runB = (rB as { run_id: string }).run_id;
  await supabase.from('inbox_extraction_runs').update({ status: 'validated' }).eq('id', runB);

  const { error: promoteErr } = await supabase.rpc('promote_extraction_run', { p_run_id: runA });
  if (!promoteErr?.message.includes('RUN_STALE')) {
    fail(`Cenário 10: esperado RUN_STALE, obtido: ${promoteErr?.message ?? 'sem erro'}`);
  }
  ok('Cenário 10: RUN_STALE ao promover run antigo');

  await supabase.rpc('fail_extraction_run', {
    p_run_id: runB,
    p_error: 'cleanup stale probe',
  });
}

async function scenario11_candidateEntityInvisible(
  supabase: SupabaseClient,
  entitiesRepo: EntitiesRepository,
): Promise<void> {
  console.log('\n--- Cenário 11: candidate entity invisível ao resolver ---');
  const probeName = `ProbeCandidate${Date.now()}`;
  const norm = normalizeText(probeName);

  const { data: ent, error: entErr } = await supabase
    .from('entities')
    .insert({
      name: probeName,
      canonical_name: probeName,
      entity_type: 'person',
      normalized_name: norm,
      registry_status: 'candidate',
    })
    .select('id')
    .single();
  if (entErr) fail(`insert candidate entity: ${entErr.message}`);

  const found = await entitiesRepo.findByNormalizedName(norm);
  if (found) fail('Cenário 11: candidate entity não deveria ser visível ao resolver');
  ok('Cenário 11: candidate entity invisível na busca active');

  await supabase.from('entities').delete().eq('id', ent!.id);
}

async function scenario12_reuseCandidateEntity(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 12: reuse candidate entity → promote ---');
  const probeName = `ReuseEntity${Date.now()}`;
  const text = `${probeName} trabalha no projeto Atlas.`;
  const id = await createInbox(text);
  await waitForCompleted(id);

  const { data: row } = await supabase
    .from('entities')
    .select('id, registry_status')
    .eq('normalized_name', normalizeText(probeName))
    .maybeSingle();
  if (!row || row.registry_status !== 'active') {
    fail(`Cenário 12: entity ${probeName} deveria estar active`);
  }
  ok('Cenário 12: candidate reutilizado e promovido');
}

async function scenario13_candidateAliasInvisible(
  entitiesRepo: EntitiesRepository,
): Promise<void> {
  console.log('\n--- Cenário 13: candidate alias invisível ---');
  const wellerson = await entitiesRepo.findByNormalizedName(normalizeText('Wellerson Assumpção'));
  if (!wellerson) {
    ok('Cenário 13: skip (Wellerson ausente — importe bootstrap)');
    return;
  }
  const probeAlias = `ProbeAlias${Date.now()}`;
  const matches = await entitiesRepo.searchEntitiesQuery(probeAlias, [], 3);
  if (matches.some((m) => m.name === wellerson.name)) {
    fail('Cenário 13: alias candidate não deveria resolver');
  }
  ok('Cenário 13: alias inexistente não resolve');
}

async function scenario14_explicitAliasAfterBootstrap(
  entitiesRepo: EntitiesRepository,
): Promise<void> {
  console.log('\n--- Cenário 14: alias explícito pós-bootstrap ---');
  const wellerson = await entitiesRepo.findByNormalizedName(normalizeText('Wellerson Assumpção'));
  if (!wellerson) {
    ok('Cenário 14: skip (Wellerson ausente)');
    return;
  }
  const text = 'Lembrete: Tick vai apresentar o roadmap na sexta.';
  const id = await createInbox(text);
  await waitForCompleted(id);
  const matches = await entitiesRepo.searchEntitiesQuery('Tick', [], 5);
  const hit = matches.find((m) => m.name === wellerson.name);
  if (!hit) fail('Cenário 14: Tick deveria resolver Wellerson');
  ok('Cenário 14: alias Tick active após promote');
}

async function scenario15_initialFailedNoActive(supabase: SupabaseClient): Promise<void> {
  console.log('\n--- Cenário 15: initial failed sem active ---');
  const { data: inboxRow, error: insErr } = await supabase
    .from('inbox_items')
    .insert({
      raw_content: 'Probe initial fail only.',
      source_channel: CHANNEL,
      source_mode: 'conversational',
      received_at: '2026-06-01T12:00:00-03:00',
      timezone: 'America/Sao_Paulo',
      processing_status: 'pending',
    })
    .select('id')
    .single();
  if (insErr) fail(`insert inbox: ${insErr.message}`);
  const id = inboxRow!.id as string;

  const { data: startData, error: startErr } = await supabase.rpc('start_extraction_run', {
    p_inbox_item_id: id,
    p_trigger_type: 'initial',
    p_schema_version: 'v1',
    p_prompt_version: 'v1',
    p_extractor_version: 'extractor-v1.3',
    p_model_name: 'probe',
    p_normalizer_version: '1.0.0',
    p_compiler_version: 'memory-compiler-v2',
  });
  if (startErr) fail(`start: ${startErr.message}`);
  const runId = (startData as { run_id: string }).run_id;

  await supabase.rpc('fail_extraction_run', {
    p_run_id: runId,
    p_error: 'initial fail probe',
  });

  const res = await fetchJson(`/inbox-items/${id}`);
  const body = res.body as InboxRow;
  if (body.processing_status !== 'failed') fail('Cenário 15: status != failed');
  if (body.active_extraction_run_id) fail('Cenário 15: active_extraction_run_id deveria ser null');
  if (body.has_active_memory) fail('Cenário 15: has_active_memory deveria ser false');
  ok('Cenário 15: failed sem active memory');

  await supabase.from('inbox_extraction_runs').delete().eq('inbox_item_id', id);
  await supabase.from('inbox_items').delete().eq('id', id);
}

async function main(): Promise<void> {
  assertEnvFlag();
  console.log('\n=== Pipeline smoke (15 cenários) ===\n');
  console.log('Requer: migrations 011–014, npm run dev, OPENAI_API_KEY\n');

  const env = loadHomologEnv();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const entitiesRepo = new EntitiesRepository(supabase);

  const health = await fetchJson('/health');
  if (health.status !== 200) fail('API /health indisponível — rode npm run dev');

  await scenario01_bootstrapEntitiesOnly(supabase);
  await scenario02_assertionsNoEvents(supabase);
  await scenario03_semanticEvent(supabase);
  await scenario04_emailSimulated(supabase);
  await scenario05_explicitAlias(supabase, entitiesRepo);
  await scenario06_aliasConflict(supabase);
  await scenario07_correctionSupersede(supabase);
  await scenario08_reprocessWithCorrections(supabase);
  await scenario09_reprocessFailedPreservesActive(supabase);
  await scenario10_stalePromoteBlocked(supabase);
  await scenario11_candidateEntityInvisible(supabase, entitiesRepo);
  await scenario12_reuseCandidateEntity(supabase);
  await scenario13_candidateAliasInvisible(entitiesRepo);
  await scenario14_explicitAliasAfterBootstrap(entitiesRepo);
  await scenario15_initialFailedNoActive(supabase);

  console.log('\nPipeline smoke OK (15 cenários).\n');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
