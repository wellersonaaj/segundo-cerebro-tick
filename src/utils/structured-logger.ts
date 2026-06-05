/**
 * Structured logger — JSON-per-line, com estágios, latência e custo.
 *
 * Padrão: uma entrada por stage, com latência, input/output, custo e erro.
 * Saída padrão: STDOUT (Fastify captura) + arquivo em LOG_DIR.
 *
 * Uso:
 *   const turn = startTurn({ turn_id, user_id, chat_id, message_id });
 *   await turn.stage('intent_classify', async () => {
 *     const out = await classifyIntent(text);
 *     return { output: out, model: 'gpt-5-mini' };
 *   });
 *   await turn.finish();
 *
 * Cada stage loga:
 *   - ts
 *   - level
 *   - stage
 *   - turn_id
 *   - user_id, chat_id, message_id
 *   - latency_ms
 *   - input, output, cost, error
 */

import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogStage =
  | 'webhook_received'
  | 'parse'
  | 'thread_resolve'
  | 'clarification_check'
  | 'intent_classify'
  | 'route_dispatch'
  | 'retrieval'
  | 'retrieval_for_extraction'
  | 'rerank'
  | 'extraction'
  | 'persist'
  | 'compose'
  | 'verify'
  | 'send'
  | 'command'
  | 'error'
  | 'turn_finish';

export interface LogMeta {
  [key: string]: unknown;
}

export interface LogEntry extends LogMeta {
  ts: string;
  level: LogLevel;
  stage: LogStage | string;
  turn_id?: string;
  user_id?: number;
  chat_id?: number;
  message_id?: number;
  latency_ms?: number;
  error?: string | null;
}

const DEFAULT_LOG_DIR = '/tmp/cerebro-logs';

function resolveLogDir(): string {
  return process.env.LOG_DIR || DEFAULT_LOG_DIR;
}

function dayFilePath(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return join(resolveLogDir(), `${y}-${m}-${d}.jsonl`);
}

async function ensureLogDir(): Promise<void> {
  try {
    await mkdir(resolveLogDir(), { recursive: true });
  } catch (err) {
    // best effort — se não conseguir criar dir, cai pro stdout só
    if (process.env.LOG_DIR_DEBUG) {
      console.error('[structured-logger] mkdir failed', err);
    }
  }
}

let dirReady: Promise<void> | null = null;
function getDirReady(): Promise<void> {
  if (!dirReady) dirReady = ensureLogDir();
  return dirReady;
}

async function writeToFile(entry: LogEntry): Promise<void> {
  await getDirReady();
  const file = dayFilePath();
  try {
    await appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // fallback: stdout já recebeu, então não perdemos a entry
    if (process.env.LOG_DIR_DEBUG) {
      console.error('[structured-logger] appendFile failed', err);
    }
  }
}

function writeToStdout(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

async function log(entry: LogEntry): Promise<void> {
  // sempre stdout (Fastify captura; em teste vira visível)
  writeToStdout(entry);
  // arquivo paralelo (não bloqueia se falhar)
  void writeToFile(entry);
}

export interface TurnContext {
  turn_id: string;
  user_id?: number;
  chat_id?: number;
  message_id?: number;
  thread_id?: string;
  input?: string;
}

export interface StageOptions {
  input?: unknown;
  output?: unknown;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  meta?: LogMeta;
}

const TOKEN_COSTS: Record<string, { input: number; output: number }> = {
  // USD per 1M tokens — atualizar conforme pricing real
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

export function estimateCostUsd(model: string, inTok: number, outTok: number): number {
  const rate = TOKEN_COSTS[model];
  if (!rate) return 0;
  return (inTok * rate.input + outTok * rate.output) / 1_000_000;
}

/**
 * Inicia um turno. Tudo que acontecer depois até finish() vai carregar
 * o mesmo turn_id, user_id, chat_id, message_id em cada log entry.
 */
export function startTurn(ctx: TurnContext): TurnHandle {
  const startedAt = Date.now();
  const entries: LogEntry[] = [];
  let totalCost = 0;

  return {
    ctx,
    startedAt,

    /** Loga um stage com latência automática. Aceita função async OU dados prontos. */
    async stage(stage: LogStage | string, fnOrOpts: (() => Promise<StageOptions>) | StageOptions): Promise<LogEntry> {
      const stageStart = Date.now();
      let result: StageOptions = {};
      let error: string | null = null;
      try {
        if (typeof fnOrOpts === 'function') {
          result = await fnOrOpts();
        } else {
          result = fnOrOpts;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        // re-throw pra quem chamou decidir o que fazer
      }

      // computa custo se tokens foram passados e model também
      let cost: number | undefined = result.cost_usd;
      if (cost === undefined && result.model && (result.input_tokens || result.output_tokens)) {
        cost = estimateCostUsd(
          result.model,
          result.input_tokens ?? 0,
          result.output_tokens ?? 0,
        );
      }
      if (typeof cost === 'number') totalCost += cost;

      const entry: LogEntry = {
        ts: new Date().toISOString(),
        level: error ? 'error' : 'info',
        stage,
        turn_id: ctx.turn_id,
        user_id: ctx.user_id,
        chat_id: ctx.chat_id,
        message_id: ctx.message_id,
        latency_ms: Date.now() - stageStart,
        error,
        ...(result.meta ?? {}),
      };
      // anexa input/output/cost, mas só se tiver (evita null noise)
      if (result.input !== undefined) entry.input = result.input;
      if (result.output !== undefined) entry.output = result.output;
      if (result.model) entry.model = result.model;
      if (result.input_tokens !== undefined) entry.input_tokens = result.input_tokens;
      if (result.output_tokens !== undefined) entry.output_tokens = result.output_tokens;
      if (cost !== undefined) entry.cost_usd = Number(cost.toFixed(8));

      entries.push(entry);
      await log(entry);

      if (error) throw new Error(error);
      return entry;
    },

    async finish(meta: LogMeta = {}): Promise<LogEntry> {
      const entry: LogEntry = {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'turn_finish',
        turn_id: ctx.turn_id,
        user_id: ctx.user_id,
        chat_id: ctx.chat_id,
        message_id: ctx.message_id,
        latency_ms: Date.now() - startedAt,
        cost_usd: Number(totalCost.toFixed(8)),
        stages_logged: entries.length,
        ...meta,
      };
      await log(entry);
      return entry;
    },

    entries() {
      return entries;
    },

    totalCost() {
      return totalCost;
    },
  };
}

export interface TurnHandle {
  ctx: TurnContext;
  startedAt: number;
  stage(stage: LogStage | string, fnOrOpts: (() => Promise<StageOptions>) | StageOptions): Promise<LogEntry>;
  finish(meta?: LogMeta): Promise<LogEntry>;
  entries(): LogEntry[];
  totalCost(): number;
}

/** Helper para o webhook: loga entrada crua, retorna handle. */
export async function logWebhookReceived(meta: {
  turn_id: string;
  user_id?: number;
  chat_id?: number;
  message_id?: number;
  text_preview?: string;
}): Promise<LogEntry> {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: 'info',
    stage: 'webhook_received',
    turn_id: meta.turn_id,
    user_id: meta.user_id,
    chat_id: meta.chat_id,
    message_id: meta.message_id,
    input: meta.text_preview,
  };
  await log(entry);
  return entry;
}

/** Helper para erro fatal (catch-all). */
export async function logError(meta: {
  turn_id?: string;
  stage: string;
  error: unknown;
  meta?: LogMeta;
}): Promise<LogEntry> {
  const errorMsg = meta.error instanceof Error ? meta.error.message : String(meta.error);
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: 'error',
    stage: meta.stage,
    turn_id: meta.turn_id,
    error: errorMsg,
    stack: meta.error instanceof Error ? meta.error.stack : undefined,
    ...(meta.meta ?? {}),
  };
  await log(entry);
  return entry;
}
