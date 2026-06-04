/**
 * Homologação POST /inbox-items/:id/corrections (histórico preservado).
 * Requer API rodando e OPENAI_API_KEY.
 * Schema: greenfield v2 (title, record_status).
 */

import { createClient } from '@supabase/supabase-js';
import {
  fail,
  fetchJson,
  loadHomologEnv,
  ok,
  requireEnv,
} from './lib/homolog-helpers.js';

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']);

const ORIGINAL_TEXT = 'Marcelo participou da reunião sobre a integração.';
const CORRECTION_TEXT = 'Na verdade, Bruno participou da reunião.';

type GreenfieldEventRow = {
  id: string;
  title: string;
  source_excerpt: string;
  record_status: string;
  inbox_item_id: string;
  correction_id: string | null;
  extraction_run_id: string;
};

type IieRow = {
  record_status: string;
  extraction_run_id: string;
  entities: { name: string; entity_type: string; registry_status: string } | null;
};

async function main(): Promise<void> {
  console.log('=== Correction Smoke Test ===\n');
  console.log('Requer: npm run dev + OPENAI_API_KEY\n');

  const env = loadHomologEnv();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const create = await fetchJson('/inbox-items', {
    method: 'POST',
    body: JSON.stringify({
      raw_content: ORIGINAL_TEXT,
      source_channel: 'correction-smoke',
      source_mode: 'conversational',
      received_at: '2026-05-31T14:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    }),
  });

  if (create.status !== 201) {
    fail(`POST /inbox-items retornou ${create.status}: ${JSON.stringify(create.body)}`);
  }

  const inboxId = (create.body as { inbox_item_id: string }).inbox_item_id;
  if (!inboxId) fail('Resposta sem inbox_item_id');
  ok(`inbox_item criado: ${inboxId}`);

  const inboxBefore = await fetchJson(`/inbox-items/${inboxId}`);
  if (inboxBefore.status !== 200) {
    fail(`GET /inbox-items/:id retornou ${inboxBefore.status}`);
  }
  const rawBefore = (inboxBefore.body as { raw_content: string }).raw_content;
  if (rawBefore !== ORIGINAL_TEXT) {
    fail(`raw_content alterado antes da correção: "${rawBefore}"`);
  }
  ok('Entrada original preservada antes da correção');

  const correction = await fetchJson(`/inbox-items/${inboxId}/corrections`, {
    method: 'POST',
    body: JSON.stringify({ correction_text: CORRECTION_TEXT }),
  });

  if (correction.status !== 201) {
    fail(`POST corrections retornou ${correction.status}: ${JSON.stringify(correction.body)}`);
  }

  const correctionBody = correction.body as {
    correction_id: string;
    inbox_item_id: string;
  };
  const correctionId = correctionBody.correction_id;
  if (!correctionId) fail('Resposta sem correction_id');
  ok(`Correção aplicada: ${correctionId}`);

  const inboxAfter = await fetchJson(`/inbox-items/${inboxId}`);
  const rawAfter = (inboxAfter.body as { raw_content: string }).raw_content;
  if (rawAfter !== ORIGINAL_TEXT) {
    fail(`raw_content foi sobrescrito: "${rawAfter}"`);
  }
  if (rawAfter.includes('Bruno') || rawAfter.includes('CORREÇÃO')) {
    fail('raw_content não deve conter texto da correção');
  }
  ok('Entrada original preservada após correção');

  const { data: correctionsRows, error: corrErr } = await supabase
    .from('corrections')
    .select('id, correction_text')
    .eq('inbox_item_id', inboxId);
  if (corrErr) fail(`Supabase corrections: ${corrErr.message}`);
  if (!correctionsRows?.some((r) => r.correction_text === CORRECTION_TEXT)) {
    fail('Registro de correction não encontrado no Supabase');
  }
  ok('Correção persistida em corrections');

  const { data: runs, error: runsErr } = await supabase
    .from('inbox_extraction_runs')
    .select('id, status, trigger_type, promoted_at')
    .eq('inbox_item_id', inboxId)
    .order('created_at');
  if (runsErr) fail(`Supabase runs: ${runsErr.message}`);
  const promotedRuns = (runs ?? []).filter((r) => r.status === 'promoted');
  if (promotedRuns.length < 2) {
    fail(`Esperado >= 2 runs promoted, obtido: ${JSON.stringify(runs)}`);
  }
  ok(`${promotedRuns.length} extraction runs promoted (initial + correction)`);

  const correctionRunId = (runs ?? []).find((r) => r.trigger_type === 'correction')?.id;
  if (!correctionRunId) fail('Run de correção não encontrado');

  const { data: allEvents, error: evErr } = await supabase
    .from('events')
    .select('id, title, source_excerpt, record_status, inbox_item_id, correction_id, extraction_run_id')
    .eq('inbox_item_id', inboxId);
  if (evErr) fail(`Supabase events: ${evErr.message}`);

  const events = (allEvents ?? []) as GreenfieldEventRow[];
  const supersededMarcelo = events.filter(
    (e) =>
      e.record_status === 'superseded' &&
      (/marcelo/i.test(e.title) || /marcelo/i.test(e.source_excerpt)),
  );
  const activeEvents = events.filter((e) => e.record_status === 'active');
  if (supersededMarcelo.length < 1) {
    fail(
      `Esperado >= 1 evento superseded com Marcelo para inbox ${inboxId}: ${JSON.stringify(events)}`,
    );
  }
  ok('Supabase: >= 1 evento superseded com Marcelo');
  const correctionActiveEvents = activeEvents.filter(
    (e) => e.extraction_run_id === correctionRunId,
  );
  if (correctionActiveEvents.length < 1) {
    fail(`Esperado evento active do run de correção: ${JSON.stringify(events)}`);
  }

  const activeEventIds = correctionActiveEvents.map((e) => e.id);
  const { data: eventLinks, error: linkErr } = await supabase
    .from('event_entities')
    .select('event_id, entity_reference, relation_type, entities(name)')
    .in('event_id', activeEventIds);
  if (linkErr) fail(`Supabase event_entities: ${linkErr.message}`);

  const brunoOnActiveEvent = (eventLinks ?? []).some((link) => {
    const ref = String(link.entity_reference ?? '');
    const name = (link.entities as { name?: string } | null)?.name ?? '';
    return /bruno/i.test(ref) || /bruno/i.test(name);
  });

  const brunoInActiveEventText = activeEvents.some(
    (e) => /bruno/i.test(e.title) || /bruno/i.test(e.source_excerpt),
  );

  if (!brunoOnActiveEvent && !brunoInActiveEventText) {
    fail(
      `Esperado Bruno como participante do evento active (event_entities ou texto): ` +
        `events=${JSON.stringify(correctionActiveEvents)} links=${JSON.stringify(eventLinks)}`,
    );
  }
  ok('Supabase: evento active com Bruno (participant ou texto)');

  const { data: iieRows, error: iieErr } = await supabase
    .from('inbox_item_entities')
    .select('record_status, extraction_run_id, entities(name, entity_type, registry_status)')
    .eq('inbox_item_id', inboxId);
  if (iieErr) fail(`Supabase inbox_item_entities: ${iieErr.message}`);

  const iie = (iieRows ?? []) as IieRow[];
  const activeMarcelo = iie.filter(
    (row) =>
      row.record_status === 'active' &&
      /marcelo/i.test(row.entities?.name ?? ''),
  );
  if (activeMarcelo.length > 0) {
    fail(
      `Marcelo não deve ter IIE active após correção (mesmo fato corrigido): ${JSON.stringify(activeMarcelo)}`,
    );
  }
  ok('Marcelo sem IIE active conflitante');

  const activeBrunoIie = iie.filter(
    (row) =>
      row.record_status === 'active' &&
      /bruno/i.test(row.entities?.name ?? ''),
  );
  if (activeBrunoIie.length < 1) {
    fail(`Esperado IIE active para Bruno: ${JSON.stringify(iie)}`);
  }
  ok('Bruno com IIE active');

  const peripheralCanonical = iie.filter(
    (row) =>
      row.record_status === 'active' &&
      row.entities &&
      !['person', 'company', 'project', 'product'].includes(row.entities.entity_type) &&
      (/reuni/i.test(row.entities.name) || /^integra/i.test(row.entities.name)),
  );
  if (peripheralCanonical.length > 0) {
    fail(`Entidades periféricas canônicas indevidas: ${JSON.stringify(peripheralCanonical)}`);
  }
  ok('Sem entidade canônica active para reunião/integração genérica');

  const { data: blockingClar, error: clarErr } = await supabase
    .from('clarification_requests')
    .select('issue_type, blocking_scope, materiality, status, target_reference')
    .eq('inbox_item_id', inboxId)
    .eq('status', 'pending')
    .eq('materiality', 'blocking')
    .eq('blocking_scope', 'knowledge_confirmation');
  if (clarErr) fail(`Supabase clarifications: ${clarErr.message}`);
  if ((blockingClar ?? []).length > 0) {
    fail(`KC periférica bloqueando indevidamente: ${JSON.stringify(blockingClar)}`);
  }
  ok('Nenhuma knowledge_confirmation periférica bloqueando promote');

  const memoryBruno = await fetchJson(`/memory/search?q=${encodeURIComponent('Bruno')}`);
  if (memoryBruno.status !== 200) {
    fail(`GET /memory/search?q=Bruno retornou ${memoryBruno.status}`);
  }

  const mem = memoryBruno.body as {
    entities?: Array<{ name: string; inbox_item_id?: string }>;
    events?: Array<{ inbox_item_id: string; description: string; record_status?: string }>;
  };
  const brunoEntityHit = (mem.entities ?? []).some((e) => /bruno/i.test(e.name));
  const brunoEventHit = (mem.events ?? []).some(
    (e) =>
      e.inbox_item_id === inboxId &&
      /bruno/i.test(e.description) &&
      (e.record_status == null || e.record_status === 'active'),
  );

  if (!brunoEntityHit && !brunoEventHit && !brunoOnActiveEvent) {
    fail(
      `Bruno não recuperável via memory/search nem event_entities para inbox ${inboxId}`,
    );
  }
  ok('Bruno recuperável (entity, evento ou participant link)');

  console.log('\n=== Correction smoke concluído com sucesso ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
