#!/usr/bin/env tsx
/**
 * CEREBRO.OBSERVER — Telegram polling bot v2 (robust)
 *
 * Pipeline por mensagem (via RAGPipelineService):
 *   retrieve → rerank → compose → verify → send
 *
 * Logs em /tmp/observer-telegram.jsonl
 *
 * Uso:
 *   npx tsx scripts/observer-telegram-bot.ts
 *
 * Estado: last_update_id salvo em /tmp/observer-bot-state.json
 */

import { appendFile, writeFile, readFile } from 'node:fs/promises';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createRagPipeline } from '../src/services/rag/create-rag-pipeline.js';

loadDotEnv();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_ALLOWED_USER_ID = process.env.TELEGRAM_ALLOWED_USER_ID!;
const LOG_FILE = '/tmp/observer-telegram.jsonl';
const STATE_FILE = '/tmp/observer-bot-state.json';
const POLL_TIMEOUT_S = 25;

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

interface LogEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

let lastUpdateId = 0;
let stateLoaded = false;
const rag = createRagPipeline();

async function loadState(): Promise<void> {
  if (stateLoaded) return;
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const j = JSON.parse(raw);
    if (typeof j.lastUpdateId === 'number') {
      lastUpdateId = j.lastUpdateId;
    }
  } catch {
    // first run
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

async function tgApi<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
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
    const tPipeline = Date.now();
    const result = await rag.answer(text);
    await log({
      event: 'rag_pipeline',
      sources: result.sources.length,
      confidence: Number(result.confidence.toFixed(3)),
      answer_chars: result.answer.length,
      ms: Date.now() - tPipeline,
    });

    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: result.answer,
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
    } catch {
      // ignore secondary failure
    }
  }
}

async function main(): Promise<void> {
  for (const [k, v] of [
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
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      for (const u of resp.result) {
        lastUpdateId = Math.max(lastUpdateId, u.update_id);
        await saveState();
        handleUpdate(u).catch(async (e) => await log({ event: 'handler_crash', err: String(e) }));
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await log({ event: 'poll_exception', err });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
