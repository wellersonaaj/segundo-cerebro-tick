#!/usr/bin/env tsx
/**
 * CEREBRO.OBSERVER — Telegram polling bot v2 (robust)
 *
 * Pipeline por mensagem:
 *   1. retrieve: top-10 inbox_items + top-5 assertions (hybrid search)
 *   2. rerank: OpenAI rerank top-10/5 → top-5/3
 *   3. compose: LLM compõe resposta em PT, com citação de fontes
 *   4. verify: LLM checa se a resposta cobre a pergunta; se não, expande
 *   5. send: Telegram sendMessage
 *
 * Logs em /tmp/observer-telegram.jsonl (newline-delimited JSON, uma entry
 * por interação: input, retrieval, rerank, compose, verify, send, error).
 *
 * Uso:
 *   set -a; source /root/.observer_env; set +a
 *   npx tsx scripts/observer-telegram-bot.ts
 *
 * Estado: last_update_id salvo em /tmp/observer-bot-state.json (resume
 * após restart sem perder updates).
 */

import { appendFile, writeFile, readFile } from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_ALLOWED_USER_ID = process.env.TELEGRAM_ALLOWED_USER_ID!;
const LOG_FILE = '/tmp/observer-telegram.jsonl';
const STATE_FILE = '/tmp/observer-bot-state.json';
const POLL_TIMEOUT_S = 25;

const RETRIEVAL_TOP_K_INBOX = 10;
const RETRIEVAL_TOP_K_ASSERTIONS = 5;
const RERANK_KEEP_INBOX = 5;
const RERANK_KEEP_ASSERTIONS = 3;
const COMPOSE_MAX_TOKENS = 1500;  // aumentou pra caber contextos grandes
const TASKS_IN_CONTEXT = 10;  // limita tasks mostradas pro LLM (evita estourar tokens)
const OPENAI_MODEL = 'gpt-5-mini';

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number };
    text?: string;
    date: number;
  };
}

interface HybridRow {
  id: string;
  raw_content: string;
  source_channel: string | null;
  occurred_at: string | null;
  combined_score: number;
  vector_rank: number | null;
  text_rank: number | null;
}

interface OpenTask {
  id: string;
  title: string;
  due_at_local_date: string | null;
  due_at_local_time: string | null;
  status: string;
  source_excerpt: string | null;
}

interface RankedItem {
  id: string;
  text: string;
  source: string;
  date: string;
  score: number;
}

interface LogEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

let lastUpdateId = 0;
let stateLoaded = false;

async function loadState(): Promise<void> {
  if (stateLoaded) return;
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const j = JSON.parse(raw);
    if (typeof j.lastUpdateId === 'number') {
      lastUpdateId = j.lastUpdateId;
    }
  } catch {
    // first run, fine
  }
  stateLoaded = true;
}

async function saveState(): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify({ lastUpdateId, savedAt: new Date().toISOString() }, null, 2));
}

async function log(entry: Omit<LogEntry, 'ts'>): Promise<void> {
  const e: LogEntry = { ts: new Date().toISOString(), ...entry };
  await appendFile(LOG_FILE, JSON.stringify(e) + '\n');
}

async function tgApi<T = any>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`tg ${method}: ${r.status} ${errBody.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

async function openai<T = any>(path: string, body: Record<string, unknown>, maxRetries = 2): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(`https://api.openai.com/v1/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`openai ${path}: ${r.status} ${txt.slice(0, 200)}`);
          await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
          continue;
        }
        throw new Error(`openai ${path}: ${r.status} ${txt.slice(0, 200)}`);
      }
      return (await r.json()) as T;
    } catch (e) {
      lastErr = e as Error;
      if (attempt === maxRetries) break;
      await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('openai unknown error');
}

async function embed(text: string): Promise<number[]> {
  const d = await openai<{ data: Array<{ embedding: number[] }> }>('embeddings', {
    model: 'text-embedding-3-small',
    input: text,
  });
  return d.data[0].embedding;
}

async function hybridSearch(table: 'inbox_items' | 'assertions', query: string, limit: number): Promise<HybridRow[]> {
  const emb = await embed(query);
  const vecStr = '[' + emb.join(',') + ']';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hybrid_search_${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_query_embedding: vecStr, p_query_text: query, p_limit: limit }),
  });
  if (!r.ok) throw new Error(`rpc hybrid_search_${table}: ${r.status}`);
  return (await r.json()) as HybridRow[];
}

async function listOpenTasks(limit = 20): Promise<OpenTask[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?status=eq.open` +
    `&order=due_at_local_date.asc.nullslast,created_at.asc&limit=${limit}` +
    `&select=id,title,due_at_local_date,due_at_local_time,status,source_excerpt`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  if (!r.ok) throw new Error(`tasks list: ${r.status}`);
  return (await r.json()) as OpenTask[];
}

async function rerank(query: string, items: HybridRow[], keep: number): Promise<RankedItem[]> {
  if (items.length === 0) return [];
  if (items.length <= keep) {
    return items.map(toRanked);
  }

  const numbered = items.map((it, i) => {
    const src = it.source_channel ?? 'memory';
    const date = it.occurred_at ? String(it.occurred_at).slice(0, 16) : '';
    return `[${i + 1}] (${src}${date ? ' · ' + date : ''})\n${it.raw_content.slice(0, 500)}`;
  }).join('\n\n');

  const prompt = `Voce e um reranker. Dada a PERGUNTA, atribua uma nota de 0 a 10 a cada candidato pela relevancia. Responda APENAS com a lista numerada de notas, uma por linha, na mesma ordem dos candidatos.

PERGUNTA: ${query}

CANDIDATOS:
${numbered}

NOTAS (uma por linha, 0-10):`;

  const d = await openai<{ choices: Array<{ message: { content: string } }> }>('chat/completions', {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 200,
  });
  const content = d.choices[0]?.message?.content ?? '';
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const scored = items.map((it, i) => {
    const line = lines[i] ?? '0';
    const m = line.match(/-?\d+(\.\d+)?/);
    const score = m ? Math.max(0, Math.min(10, parseFloat(m[0]))) : 0;
    return { item: it, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, keep).map(s => toRanked(s.item, s.score));
}

function toRanked(it: HybridRow, score?: number): RankedItem {
  return {
    id: it.id,
    text: it.raw_content,
    source: it.source_channel ?? 'memory',
    date: it.occurred_at ? String(it.occurred_at).slice(0, 16) : '',
    score: score ?? it.combined_score,
  };
}

async function compose(query: string, context: RankedItem[], tasks: OpenTask[] = []): Promise<string> {
  const sections: string[] = [];
  if (context.length > 0) {
    const ctxStr = context.map((c, i) => {
      return `[${i + 1}] ${c.source}${c.date ? ' · ' + c.date : ''}\n${c.text.slice(0, 700)}`;
    }).join('\n\n---\n\n');
    sections.push(`MEMORIA (capturas anteriores):\n${ctxStr}`);
  }
  if (tasks.length > 0) {
    const taskStr = tasks.map((t, i) => {
      const due = t.due_at_local_date ?? 'sem prazo';
      return `T${i + 1} | ${due} | ${t.title}${t.source_excerpt ? ' (' + t.source_excerpt.slice(0, 80) + ')' : ''}`;
    }).join('\n');
    sections.push(`TAREFAS ABERTAS (cadastro direto, nao busca semantica, TOTAL: ${tasks.length}):\n${taskStr}`);
  }
  if (sections.length === 0) {
    return 'Nao encontrei nada relevante na memoria sobre isso ainda.';
  }

  const prompt = `Voce e o assistente de memoria pessoal do Wellerson (conheca o usuario pelo nome). Responda em portugues, conciso e PRECISO.

REGRAS:
- Use APENAS o que esta nas secoes MEMORIA e TAREFAS ABAIXO. NAO invente, NAO complete com conhecimento geral.
- Se faltar info, diga: "Nao tenho isso na memoria ainda." NAO chute.
- Ao falar do usuario, chame-o de "Wellerson" ou "voce" (nunca "o usuario").
- Ao mencionar QUALQUER pessoa, compromisso, ou evento, USE O NOME PROPRIO (Lari, Breno, Bruno, etc). Nao substitua por pronomes como "ela", "ele" — o usuario quer ver quem.
- Se a secao TAREFAS tem items e a pergunta eh sobre tarefas/compromissos/pendentes, LISTE TODAS as tarefas da secao TAREFAS usando T1, T2 etc, em formato lista. NAO resuma, NAO escolha soh uma.
- Cite fontes [1], [2] etc para a memoria; cite "T1, T2" etc para tarefas.
- Maximo 6 frases. Direto ao ponto. Se a pergunta tem varios aspectos, cubra todos ou admita o que falta.

${sections.join('\n\n---\n\n')}

PERGUNTA: ${query}

RESPOSTA:`;

  const d = await openai<{ choices: Array<{ finish_reason?: string; message: { content: string } }> }>('chat/completions', {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: COMPOSE_MAX_TOKENS,
  });
  const choice = d.choices[0];
  const content = choice?.message?.content ?? '';
  if (!content || content.trim() === '') {
    throw new Error(`compose: empty content (finish_reason=${choice?.finish_reason ?? 'n/a'})`);
  }
  return content;
}

async function verifyCoverage(query: string, draft: string, allContext: RankedItem[], tasks: OpenTask[]): Promise<{ ok: boolean; reason?: string }> {
  const mentionsCtx = (draft.match(/\[(\d+)\]/g) ?? []).length > 0;
  const mentionsTasks = /\bT\d+\b/.test(draft);
  const admitsMissing = /nao tenho|nao encontrei|nao ha registro|sem tarefas abertas/i.test(draft);

  if (allContext.length > 0 && !mentionsCtx && !admitsMissing) {
    return { ok: false, reason: 'no citations and no explicit missing-info admission' };
  }
  if (tasks.length > 0 && /taref|pendente|compromisso/i.test(query) && !mentionsTasks && !admitsMissing) {
    return { ok: false, reason: 'question about tasks but no T# citation and no missing-info admission' };
  }
  return { ok: true };
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  const msg = u.message;
  if (!msg?.text) return;
  if (String(msg.from?.id) !== TELEGRAM_ALLOWED_USER_ID) {
    await log({ event: 'skip', reason: 'not_allowed', from: msg.from?.id });
    return;
  }
  const text = msg.text.trim();
  if (!text) return;

  const t0 = Date.now();
  await log({ event: 'msg_in', message_id: msg.message_id, from: msg.from?.first_name, text: text.slice(0, 200) });

  try {
    // 1) retrieve
    const tR = Date.now();
    const [inbox, assertions, allTasks] = await Promise.all([
      hybridSearch('inbox_items', text, RETRIEVAL_TOP_K_INBOX),
      hybridSearch('assertions', text, RETRIEVAL_TOP_K_ASSERTIONS),
      listOpenTasks(20).catch(e => {
        log({ event: 'tasks_list_error', err: String(e) });
        return [] as OpenTask[];
      }),
    ]);
    // Limita tasks no contexto para TASKS_IN_CONTEXT (evita estourar tokens do LLM)
    const tasks = allTasks.slice(0, TASKS_IN_CONTEXT);
    await log({ event: 'retrieve', inbox: inbox.length, assertions: assertions.length, tasks: tasks.length, ms: Date.now() - tR });

    // 2) rerank
    const tRR = Date.now();
    const [inboxRanked, assertionsRanked] = await Promise.all([
      rerank(text, inbox, RERANK_KEEP_INBOX),
      rerank(text, assertions, RERANK_KEEP_ASSERTIONS),
    ]);
    const allContext = [...inboxRanked, ...assertionsRanked];
    await log({
      event: 'rerank',
      inbox_kept: inboxRanked.length,
      assertions_kept: assertionsRanked.length,
      scores: allContext.map(c => c.score.toFixed(1)),
      ms: Date.now() - tRR,
    });

    // 3) compose
    const tC = Date.now();
    let draft = await compose(text, allContext, tasks);
    await log({ event: 'compose_draft', chars: draft.length, tasks_in_context: tasks.length, ms: Date.now() - tC });

    // 4) verify
    const tV = Date.now();
    const check = await verifyCoverage(text, draft, allContext, tasks);
    await log({ event: 'verify', ok: check.ok, reason: check.reason ?? null, ms: Date.now() - tV });

    if (!check.ok) {
      // weak fallback: append a notice
      draft = draft + '\n\n_(Resposta baseada em poucos itens; se faltou algo, reformule ou pergunte de outro jeito.)_';
    }

    // 5) send
    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: draft,
      reply_to_message_id: msg.message_id,
    });
    await log({ event: 'sent', total_ms: Date.now() - t0 });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await log({ event: 'error', err, total_ms: Date.now() - t0 });
    try {
      await tgApi('sendMessage', {
        chat_id: msg.chat.id,
        text: `Desculpe, deu erro interno: ${err.slice(0, 200)}`,
      });
    } catch {}
  }
}

async function main(): Promise<void> {
  for (const [k, v] of [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
    ['OPENAI_API_KEY', OPENAI_API_KEY],
    ['TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN],
    ['TELEGRAM_ALLOWED_USER_ID', TELEGRAM_ALLOWED_USER_ID],
  ] as const) {
    if (!v) {
      console.error(`Falta env var: ${k}`);
      process.exit(1);
    }
  }

  await loadState();

  const me = await tgApi<{ ok: boolean; result: { id: number; first_name: string } }>('getMe');
  if (!me.ok) {
    console.error('Bot invalido:', me);
    process.exit(1);
  }
  await log({ event: 'startup', bot: `@${me.result.first_name}`, id: me.result.id, lastUpdateId });

  await tgApi('deleteWebhook', { drop_pending_updates: false });
  await log({ event: 'webhook_cleared' });

  while (true) {
    try {
      const resp = await tgApi<{ ok: boolean; result: TgUpdate[] }>('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ['message'],
      });
      if (!resp.ok) {
        await log({ event: 'poll_error', body: JSON.stringify(resp).slice(0, 200) });
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      for (const u of resp.result) {
        lastUpdateId = Math.max(lastUpdateId, u.update_id);
        await saveState();
        handleUpdate(u).catch(async e => await log({ event: 'handler_crash', err: String(e) }));
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await log({ event: 'poll_exception', err });
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
