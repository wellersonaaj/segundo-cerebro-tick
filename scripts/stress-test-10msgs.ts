/**
 * Stress test: 10 mensagens em sequência pelo webhook do Telegram.
 *
 * Objetivo: validar que o orchestrator (intent classify + save/query + extract +
 * embedder + RAG) aguenta 10 mensagens em row sem save perdido, sem crash, e
 * com latência bounded.
 *
 * Pré-requisito: API rodando (`npm run dev`) e credenciais em `.env`.
 *
 * Uso: `npm run test:stress:10msg`
 *
 * Métricas reportadas:
 * - total_msgs, success_count, fail_count
 * - latência média / p95 / max por mensagem
 * - status final de cada inbox (completed / failed / stuck)
 * - tempo total wall-clock
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createClient } from '@supabase/supabase-js';

loadDotEnv();

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const PORT = process.env.PORT ?? '3000';
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const ALLOWED_USER_ID = Number(process.env.TELEGRAM_ALLOWED_USER_ID ?? 1);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

const N = 10;
const REQUEST_TIMEOUT_MS = 180_000;
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const STRESS_TAG = 'stress-10msgs';

// 10 mensagens variadas: 5 save, 3 query, 1 update, 1 command
const MESSAGES: Array<{ kind: string; text: string }> = [
  { kind: 'save', text: `Anotei que combinei com o Breno de revisar o código da Y amanhã às 10h [${STRESS_TAG}-1]` },
  { kind: 'save', text: `Lari confirmou que vem pro aniversário sábado [${STRESS_TAG}-2]` },
  { kind: 'query', text: `o que eu tenho com o Breno? [${STRESS_TAG}-3]` },
  { kind: 'save', text: `Paguei R$ 250 no almoço com cliente da ESX [${STRESS_TAG}-4]` },
  { kind: 'save', text: `Bruno pediu pra eu ligar pra ele sobre a Genius [${STRESS_TAG}-5]` },
  { kind: 'query', text: `me lembra o que combinei com a Lari [${STRESS_TAG}-6]` },
  { kind: 'save', text: `Recebi o IP da Genius ontem, tá com problema [${STRESS_TAG}-7]` },
  { kind: 'command', text: '/status' },
  { kind: 'save', text: `Marcelo vai entrar como sênior na equipe nova [${STRESS_TAG}-8]` },
  { kind: 'query', text: `o que eu sei sobre a Genius? [${STRESS_TAG}-9]` },
];

interface InboxStatus {
  id: string;
  processing_status: string;
  received_at: string;
  raw_content: string;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

function checkEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    fail(`Variáveis ausentes: ${missing.join(', ')}`);
  }
  if (!WEBHOOK_SECRET) fail('TELEGRAM_WEBHOOK_SECRET não definido');
  ok('Env ok');
}

async function postTelegramUpdate(
  text: string,
  updateId: number,
  messageId: number,
): Promise<{ status: number; latencyMs: number; body: unknown }> {
  const update = {
    update_id: updateId,
    message: {
      message_id: messageId,
      from: { id: ALLOWED_USER_ID, is_bot: false, first_name: 'Stress' },
      chat: { id: ALLOWED_USER_ID, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/webhooks/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    return { status: res.status, latencyMs, body };
  } finally {
    clearTimeout(timer);
  }
}

async function pollInboxStatus(
  supabase: ReturnType<typeof createClient>,
  inboxId: string,
): Promise<InboxStatus> {
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_TIMEOUT_MS) {
    const { data, error } = await supabase
      .from('inbox_items')
      .select('id, processing_status, received_at, raw_content')
      .eq('id', inboxId)
      .single();
    if (error) throw new Error(`poll ${inboxId}: ${error.message}`);
    if (data && (data.processing_status === 'completed' || data.processing_status === 'failed')) {
      return data as InboxStatus;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  fail(`Inbox ${inboxId} não terminou em ${POLL_TIMEOUT_MS}ms`);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function main(): Promise<void> {
  console.log('=== Stress test: 10 mensagens em sequência ===\n');
  console.log(`Base URL: ${BASE}`);
  console.log(`User ID: ${ALLOWED_USER_ID}`);
  console.log(`Messages: ${MESSAGES.length}\n`);

  checkEnv();

  // Health
  const healthRes = await fetch(`${BASE}/health`);
  if (healthRes.status !== 200) fail(`GET /health -> ${healthRes.status}. API tá rodando?`);
  ok('GET /health');

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`\nDisparando ${MESSAGES.length} mensagens sequencialmente...\n`);
  const wallStart = Date.now();
  const results: Array<{
    idx: number;
    kind: string;
    httpStatus: number;
    webhookLatencyMs: number;
    inboxId: string | null;
    finalStatus: string;
    endToEndMs: number;
    error: string | null;
  }> = [];

  for (let i = 0; i < MESSAGES.length; i += 1) {
    const m = MESSAGES[i];
    const t0 = Date.now();
    let inboxId: string | null = null;
    let finalStatus = 'unknown';
    let endToEndMs = 0;
    let error: string | null = null;
    let httpStatus = 0;
    let webhookLatencyMs = 0;

    try {
      const r = await postTelegramUpdate(m.text, 100_000 + i, 100_000 + i);
      httpStatus = r.status;
      webhookLatencyMs = r.latencyMs;
      if (r.status !== 200) {
        error = `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`;
      } else {
        const body = r.body as { inbox_item_id?: string; kind?: string; ignored?: boolean };
        if (body.ignored) {
          // command ou duplicata — sem inbox criada
          finalStatus = 'ignored';
        } else if (body.inbox_item_id) {
          inboxId = body.inbox_item_id;
          const polled = await pollInboxStatus(supabase, inboxId);
          finalStatus = polled.processing_status;
        } else {
          error = 'Resposta sem inbox_item_id nem ignored';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    endToEndMs = Date.now() - t0;
    results.push({
      idx: i + 1,
      kind: m.kind,
      httpStatus,
      webhookLatencyMs,
      inboxId,
      finalStatus,
      endToEndMs,
      error,
    });

    const tag = error ? '✗' : '✓';
    console.log(
      `  ${tag} [${i + 1}/${MESSAGES.length}] ${m.kind.padEnd(7)} http=${httpStatus} webhook=${webhookLatencyMs}ms end2end=${endToEndMs}ms inbox=${inboxId ?? '-'} status=${finalStatus}${error ? ` err=${error}` : ''}`,
    );
  }

  const wallMs = Date.now() - wallStart;
  const latencies = results.map((r) => r.endToEndMs);
  const okResults = results.filter((r) => !r.error && r.finalStatus === 'completed');
  const failResults = results.filter((r) => r.error || r.finalStatus === 'failed');
  const ignored = results.filter((r) => r.finalStatus === 'ignored');

  console.log('\n--- Resumo ---');
  console.log(`Total: ${results.length}`);
  console.log(`Completadas: ${okResults.length}`);
  console.log(`Falharam: ${failResults.length}`);
  console.log(`Ignoradas (comandos/duplicatas): ${ignored.length}`);
  console.log(`Tempo total: ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`Latência end-to-end:`);
  console.log(`  média: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)}ms`);
  console.log(`  p95:   ${percentile(latencies, 95)}ms`);
  console.log(`  max:   ${Math.max(...latencies)}ms`);

  if (failResults.length > 0) {
    console.log('\nFalhas:');
    for (const f of failResults) {
      console.log(`  [${f.idx}] ${f.kind}: ${f.error ?? `status=${f.finalStatus}`}`);
    }
    fail(`${failResults.length}/${results.length} mensagens falharam`);
  }

  ok(`\nTodas as ${okResults.length} saves/queries completaram em ${(wallMs / 1000).toFixed(1)}s`);

  // Cleanup: marca inboxes de teste como archived pra não poluir o grafo
  const inboxIds = results.map((r) => r.inboxId).filter((id): id is string => id != null);
  if (inboxIds.length > 0) {
    console.log(`\nLimpando ${inboxIds.length} inboxes de teste (archive)...`);
    // Read-modify-write: pega metadata atual e adiciona archived:true
    const { data: existing, error: readErr } = await supabase
      .from('inbox_items')
      .select('id, metadata')
      .in('id', inboxIds);
    if (readErr) {
      console.warn(`  Cleanup read falhou (não-bloqueante): ${readErr.message}`);
    } else {
      for (const row of existing ?? []) {
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        await supabase
          .from('inbox_items')
          .update({ metadata: { ...meta, archived: true, stress_test: STRESS_TAG } })
          .eq('id', row.id);
      }
      ok('Inboxes arquivadas');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
