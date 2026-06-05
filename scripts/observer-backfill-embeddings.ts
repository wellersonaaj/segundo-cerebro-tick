#!/usr/bin/env tsx
/**
 * CEREBRO.OBSERVER — Backfill de embeddings
 *
 * Sem dependências externas (sem npm install): usa apenas fetch nativo + Supabase REST.
 *
 * Para cada row de inbox_items, events, assertions que NÃO tem embedding ainda,
 * gera o embedding via OpenAI (text-embedding-3-small, 1536 dim) e faz PATCH via REST.
 *
 * Idempotente: pula rows que já têm embedding.
 *
 * Uso:
 *   set -a; source /root/.observer_env; set +a
 *   npx tsx scripts/observer-backfill-embeddings.ts
 *   npx tsx scripts/observer-backfill-embeddings.ts --batch=50 --only=inbox_items --dry-run
 */

const BATCH_SIZE = Number(process.argv.find(a => a.startsWith('--batch='))?.split('=')[1] ?? 50);
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error('Faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY');
  process.exit(1);
}

const SB_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
const OA_HEADERS = {
  'Content-Type': 'application/json',
  authorization: `Bearer ${OPENAI_API_KEY}`,
};

interface TextRow { id: string; text: string; }

async function fetchPending(table: 'inbox_items' | 'events' | 'assertions' | 'procedures', selectCols: string): Promise<TextRow[]> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${selectCols}&embedding=is.null&limit=1000`,
    { headers: SB_HEADERS },
  );
  if (!resp.ok) throw new Error(`fetch ${table}: ${resp.status} ${await resp.text()}`);
  return (await resp.json()) as Array<Record<string, unknown>>;
}

async function embed(texts: string[]): Promise<number[][]> {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: OA_HEADERS,
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!resp.ok) throw new Error(`openai: ${resp.status} ${await resp.text()}`);
  const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

async function updateEmbedding(table: string, id: string, embedding: number[]): Promise<void> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ embedding: `[${embedding.join(',')}]` }),
    },
  );
  if (!resp.ok) throw new Error(`update ${table}/${id}: ${resp.status} ${await resp.text()}`);
}

async function backfillTable(
  table: 'inbox_items' | 'events' | 'assertions' | 'procedures',
  textBuilder: (row: any) => string,
): Promise<number> {
  console.log(`\n=== ${table} ===`);
  const selectCols = table === 'inbox_items' ? 'id,raw_content'
    : table === 'events' ? 'id,title,source_excerpt'
    : table === 'assertions' ? 'id,predicate,value_text,source_excerpt'
    : 'id,name,description';

  const rows = await fetchPending(table, selectCols);
  const textRows: TextRow[] = rows.map((r: any) => ({
    id: r.id as string,
    text: textBuilder(r).trim(),
  })).filter(r => r.text.length > 0);

  console.log(`  Pending: ${rows.length} rows; ${textRows.length} com texto não-vazio`);
  if (DRY_RUN) {
    console.log('  DRY-RUN: nada será alterado.');
    return 0;
  }
  if (textRows.length === 0) return 0;

  let processed = 0;
  for (let i = 0; i < textRows.length; i += BATCH_SIZE) {
    const batch = textRows.slice(i, i + BATCH_SIZE);
    const embeddings = await embed(batch.map(b => b.text));
    for (let j = 0; j < batch.length; j++) {
      await updateEmbedding(table, batch[j].id, embeddings[j]);
    }
    processed += batch.length;
    console.log(`  Processado: ${processed}/${textRows.length}`);
    if (i + BATCH_SIZE < textRows.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  return processed;
}

function textForInbox(r: any) { return String(r.raw_content ?? ''); }
function textForEvent(r: any) { return `${r.title ?? ''} ${r.source_excerpt ?? ''}`.trim(); }
function textForAssertion(r: any) {
  return [r.predicate, r.value_text, r.source_excerpt].filter(Boolean).join(' ').trim();
}
function textForProcedure(r: any) { return `${r.name ?? ''} ${r.description ?? ''}`.trim(); }

async function main() {
  console.log(`Config: BATCH_SIZE=${BATCH_SIZE}, ONLY=${ONLY ?? 'all'}, DRY_RUN=${DRY_RUN}`);
  console.log(`Modelo: text-embedding-3-small (1536 dim)`);

  let total = 0;
  if (!ONLY || ONLY === 'inbox_items') total += await backfillTable('inbox_items', textForInbox);
  if (!ONLY || ONLY === 'events')      total += await backfillTable('events', textForEvent);
  if (!ONLY || ONLY === 'assertions')  total += await backfillTable('assertions', textForAssertion);
  if (!ONLY || ONLY === 'procedures')  total += await backfillTable('procedures', textForProcedure);

  console.log(`\n✓ Total processado: ${total} rows`);
  if (DRY_RUN) console.log('(DRY-RUN: nada foi alterado)');
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
