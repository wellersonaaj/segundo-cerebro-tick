/**
 * Homologação POST /inbox-items/:id/corrections (histórico preservado).
 * Requer API rodando e OPENAI_API_KEY.
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

  const { data: allEvents, error: evErr } = await supabase
    .from('events')
    .select('id, description, source_excerpt, status, inbox_item_id, correction_id')
    .eq('inbox_item_id', inboxId);
  if (evErr) fail(`Supabase events: ${evErr.message}`);

  const supersededMarcelo = (allEvents ?? []).filter(
    (e) =>
      e.status === 'superseded' &&
      (/marcelo/i.test(e.description) || /marcelo/i.test(e.source_excerpt)),
  );
  const activeBruno = (allEvents ?? []).filter(
    (e) =>
      e.status === 'active' &&
      (/bruno/i.test(e.description) || /bruno/i.test(e.source_excerpt)),
  );

  if (supersededMarcelo.length < 1) {
    fail(
      `Esperado >= 1 evento superseded com Marcelo para inbox ${inboxId}: ${JSON.stringify(allEvents)}`,
    );
  }
  ok('Supabase: >= 1 evento superseded com Marcelo');

  if (activeBruno.length < 1) {
    fail(
      `Esperado >= 1 evento active com Bruno para inbox ${inboxId}: ${JSON.stringify(allEvents)}`,
    );
  }
  ok('Supabase: >= 1 evento active com Bruno');

  const brunoEvent = activeBruno[0]!;
  if (brunoEvent.inbox_item_id !== inboxId) {
    fail(`Evento active Bruno com inbox_item_id errado: ${brunoEvent.inbox_item_id}`);
  }
  ok('Evento active Bruno vinculado ao inbox do correction-smoke');

  if (brunoEvent.correction_id != null) {
    if (brunoEvent.correction_id !== correctionId) {
      fail(
        `correction_id do evento active (${brunoEvent.correction_id}) != correction_id da correção (${correctionId})`,
      );
    }
    ok('Evento active vinculado à correction_id correta');
  }

  const memoryBruno = await fetchJson(`/memory/search?q=${encodeURIComponent('Bruno')}`);
  if (memoryBruno.status !== 200) {
    fail(`GET /memory/search?q=Bruno retornou ${memoryBruno.status}`);
  }

  const events = (memoryBruno.body as { events: Array<{ inbox_item_id: string; description: string }> })
    .events ?? [];
  const brunoFromThisInbox = events.filter(
    (e) => e.inbox_item_id === inboxId && /bruno/i.test(e.description),
  );

  if (brunoFromThisInbox.length < 1) {
    fail(
      `GET /memory/search?q=Bruno sem evento active deste inbox (${inboxId}). ` +
        `Eventos retornados: ${events.map((e) => `${e.inbox_item_id}:${e.description}`).join('; ')}`,
    );
  }
  ok('GET /memory/search?q=Bruno → evento active deste inbox_item_id');

  console.log('\n=== Correction smoke concluído com sucesso ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
