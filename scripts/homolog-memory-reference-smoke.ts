/**
 * Homologação: consultas do dia a dia + referências existentes vs inexistentes.
 *
 * Pré-requisitos: npm run dev, seeds greenfield (Genius Hotels), OPENAI_API_KEY.
 *
 *   npm run test:homolog:memory-reference
 */

import { createClient } from '@supabase/supabase-js';
import { fail, fetchJson, loadHomologEnv, ok, requireEnv } from './lib/homolog-helpers.js';

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']);

const GENIUS_SEED_ID = 'a0000000-0000-4000-8000-000000000099';

async function main(): Promise<void> {
  console.log('\n=== Homolog — memória e referências ===\n');

  const health = await fetchJson('/health', undefined, 15_000);
  if (health.status !== 200) fail('API indisponível — npm run dev');

  const env = loadHomologEnv();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Referência existente (seed + alias)
  const geniusSearch = await fetchJson(`/memory/search?q=${encodeURIComponent('Genius')}`);
  if (geniusSearch.status !== 200) fail(`memory/search Genius → ${geniusSearch.status}`);
  const geniusEntities = (geniusSearch.body as { entities?: Array<{ id: string; name: string }> })
    .entities ?? [];
  const hasSeed = geniusEntities.some((e) => e.id === GENIUS_SEED_ID);
  if (!hasSeed) {
    fail(`Genius deveria resolver para seed Genius Hotels; obtido: ${JSON.stringify(geniusEntities)}`);
  }
  const homonym = geniusEntities.filter(
    (e) => e.name === 'Genius' && e.id !== GENIUS_SEED_ID,
  );
  if (homonym.length > 0) {
    fail(`Entidade homônima "Genius" ativa: ${homonym.map((e) => e.id).join(', ')}`);
  }
  ok('referência existente: Genius → Genius Hotels (sem homônimo)');

  // Referência inexistente
  const missing = await fetchJson(
    `/memory/search?q=${encodeURIComponent('Empresa Fantasma Homolog XYZ')}`,
  );
  if (missing.status !== 200) fail(`memory/search inexistente → ${missing.status}`);
  const missingEntities = (missing.body as { entities?: unknown[] }).entities ?? [];
  if (missingEntities.length > 0) {
    fail(`Busca por entidade inexistente retornou matches: ${JSON.stringify(missingEntities)}`);
  }
  ok('referência inexistente: sem entidades retornadas');

  // Inserção conversacional (dia a dia)
  const post = await fetchJson('/inbox-items', {
    method: 'POST',
    body: JSON.stringify({
      raw_content:
        'Lembrete: amanhã preciso alinhar com Bruno Brant o status da integração Genius Hotels.',
      source_channel: 'homolog-memory-reference',
      source_mode: 'conversational',
      received_at: '2026-06-04T10:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    }),
  });
  if (post.status !== 201) fail(`POST inbox → ${post.status}`);
  const inboxId = (post.body as { inbox_item_id: string }).inbox_item_id;
  if ((post.body as { processing_status: string }).processing_status !== 'completed') {
    fail(`processamento não completou: ${JSON.stringify(post.body)}`);
  }
  ok(`inserção dia a dia processada: ${inboxId}`);

  const { count: rogueCount } = await supabase
    .from('entities')
    .select('id', { count: 'exact', head: true })
    .eq('normalized_name', 'genius')
    .eq('registry_status', 'active')
    .neq('id', GENIUS_SEED_ID);
  if ((rogueCount ?? 0) > 0) {
    fail(`Após ingestão, entidade homônima genius ativa: count=${rogueCount}`);
  }
  ok('inserção não criou entidade homônima Genius');

  const brunoSearch = await fetchJson(`/memory/search?q=${encodeURIComponent('Bruno Brant')}`);
  const brunoHits = (brunoSearch.body as { entities?: Array<{ name: string }> }).entities ?? [];
  if (!brunoHits.some((e) => /bruno/i.test(e.name))) {
    console.warn('⚠ Bruno não encontrado em memory/search — importe bootstrap se necessário');
  } else {
    ok('referência existente pós-ingestão: Bruno Brant recuperável');
  }

  console.log('\nHomolog memória/referências OK.\n');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
