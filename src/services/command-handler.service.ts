import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TelegramReplyMarkup } from '../telegram/telegram-bot.client.js';
import type { LogEntry } from '../utils/structured-logger.js';

export interface CommandHandlerContext {
  turn_id: string;
  chat_id: number;
  user_id: number;
}

export interface CommandHandlerResponse {
  text: string;
  parse_mode?: 'Markdown';
  reply_markup?: TelegramReplyMarkup;
}

export const STATUS_INLINE_KEYBOARD: TelegramReplyMarkup = {
  inline_keyboard: [
    [
      { text: 'Ver custos', callback_data: 'status:costs' },
      { text: 'Ver últimos 5 turnos', callback_data: 'status:turns' },
      { text: 'Ver erros', callback_data: 'status:errors' },
    ],
  ],
};

function resolveLogDir(logDir?: string): string {
  return logDir ?? process.env.LOG_DIR ?? '/tmp/cerebro-logs';
}

function dayFileName(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}.jsonl`;
}

function parseLogLines(raw: string): LogEntry[] {
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LogEntry);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function entryCost(entry: LogEntry): number {
  return typeof entry.cost_usd === 'number' && entry.cost_usd > 0 ? entry.cost_usd : 0;
}

function extractIntent(entry: LogEntry): string {
  const output = entry.output;
  if (output && typeof output === 'object' && 'intent' in output) {
    const intent = (output as { intent?: unknown }).intent;
    if (typeof intent === 'string') return intent;
  }
  return '';
}

function truncateField(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function sanitizeEntry(entry: LogEntry): LogEntry {
  const copy = { ...entry };
  for (const key of ['input', 'output'] as const) {
    const val = copy[key];
    if (typeof val === 'string') {
      copy[key] = truncateField(val, 500);
    } else if (val && typeof val === 'object') {
      copy[key] = JSON.parse(
        JSON.stringify(val, (_k, v) =>
          typeof v === 'string' ? truncateField(v, 500) : v,
        ),
      );
    }
  }
  return copy;
}

function formatLogLine(entry: LogEntry): string {
  const intent = extractIntent(entry);
  const latency = entry.latency_ms ?? 0;
  return `${entry.ts} | ${entry.stage} | ${latency}ms | ${intent}`;
}

export class CommandHandlerService {
  constructor(private readonly logDir?: string) {}

  async handle(
    command: string,
    args: string[],
    ctx: CommandHandlerContext,
  ): Promise<CommandHandlerResponse> {
    const normalized = command.toLowerCase();
    switch (normalized) {
      case '/status':
        return {
          text: await this.formatStatus(new Date()),
          parse_mode: 'Markdown',
          reply_markup: STATUS_INLINE_KEYBOARD,
        };
      case '/debug':
        return {
          text: await this.formatDebug(args[0], ctx.turn_id),
          parse_mode: 'Markdown',
        };
      case '/help':
        return { text: this.formatHelp(), parse_mode: 'Markdown' };
      case '/costs':
        return { text: await this.formatCosts(), parse_mode: 'Markdown' };
      case '/log':
        return { text: await this.formatLog(), parse_mode: 'Markdown' };
      default:
        return { text: `Comando desconhecido: ${command}\n\n${this.formatHelp()}` };
    }
  }

  async handleStatusCallback(data: string): Promise<CommandHandlerResponse> {
    switch (data) {
      case 'status:costs':
        return { text: await this.formatCosts(), parse_mode: 'Markdown' };
      case 'status:turns':
        return { text: await this.formatRecentTurns(5), parse_mode: 'Markdown' };
      case 'status:errors':
        return { text: await this.formatErrors(), parse_mode: 'Markdown' };
      default:
        return { text: `Callback desconhecido: ${data}` };
    }
  }

  async readLogsFor(date: Date): Promise<LogEntry[]> {
    const file = join(resolveLogDir(this.logDir), dayFileName(date));
    try {
      const raw = await readFile(file, 'utf8');
      return parseLogLines(raw);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw err;
    }
  }

  private async readLogsSince(hours: number): Promise<LogEntry[]> {
    const now = Date.now();
    const cutoff = now - hours * 60 * 60 * 1000;
    const entries: LogEntry[] = [];
    for (let offset = 0; offset <= 1; offset += 1) {
      const date = new Date(now - offset * 24 * 60 * 60 * 1000);
      const dayEntries = await this.readLogsFor(date);
      for (const entry of dayEntries) {
        const ts = Date.parse(entry.ts);
        if (!Number.isNaN(ts) && ts >= cutoff) entries.push(entry);
      }
    }
    return entries.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }

  private sumCost(entries: LogEntry[]): number {
    return entries.reduce((sum, e) => sum + entryCost(e), 0);
  }

  private async formatStatus(date: Date): Promise<string> {
    const entries = await this.readLogsFor(date);
    const finishes = entries.filter((e) => e.stage === 'turn_finish');
    const latencies = finishes
      .map((e) => e.latency_ms)
      .filter((v): v is number => typeof v === 'number');
    const totalCost = this.sumCost(entries);
    const p95 = percentile(latencies, 95);
    return [
      '*Status do dia*',
      `turns: ${finishes.length}`,
      `p95_latency: ${Math.round(p95)}ms`,
      `cost_usd: $${totalCost.toFixed(4)}`,
    ].join('\n');
  }

  private async resolveDebugTurnId(
    turnIdArg: string | undefined,
    fallbackTurnId: string,
  ): Promise<string> {
    if (turnIdArg?.trim()) return turnIdArg.trim();
    const today = await this.readLogsFor(new Date());
    const finishes = today.filter((e) => e.stage === 'turn_finish' && e.turn_id);
    const last = finishes[finishes.length - 1];
    if (last?.turn_id) return last.turn_id;
    return fallbackTurnId;
  }

  private async formatDebug(turnIdArg: string | undefined, fallbackTurnId: string): Promise<string> {
    const turnId = await this.resolveDebugTurnId(turnIdArg, fallbackTurnId);
    const today = await this.readLogsFor(new Date());
    const yesterday = await this.readLogsFor(new Date(Date.now() - 86_400_000));
    const matches = [...today, ...yesterday].filter((e) => e.turn_id === turnId);
    if (!matches.length) {
      return `Nenhum log encontrado para turn_id=\`${turnId}\``;
    }
    const blocks = matches.map((e) => {
      const lines = [
        `[${e.stage}] ${e.latency_ms ?? 0}ms`,
        e.error ? `err=${e.error}` : null,
        e.output ? `out=${JSON.stringify(e.output).slice(0, 200)}` : null,
      ].filter(Boolean);
      return '```\n' + lines.join('\n') + '\n```';
    });
    return [`*Debug turn* \`${turnId}\``, ...blocks].join('\n\n');
  }

  private formatHelp(): string {
    return [
      '*Comandos disponíveis*',
      '/status — turns, p95 e custo do dia (com botões)',
      '/debug [turn_id] — stages do turn (último se omitido)',
      '/help — esta lista',
      '/costs — breakdown por stage (24h)',
      '/log — últimas 20 entradas (sanitizado)',
    ].join('\n');
  }

  private async formatCosts(): Promise<string> {
    const entries = await this.readLogsSince(24);
    const byStage = new Map<string, { total: number; count: number }>();
    for (const entry of entries) {
      const cost = entryCost(entry);
      if (cost <= 0) continue;
      const prev = byStage.get(entry.stage) ?? { total: 0, count: 0 };
      byStage.set(entry.stage, { total: prev.total + cost, count: prev.count + 1 });
    }
    if (!byStage.size) return 'Sem custos registrados nas últimas 24h.';
    const header = 'stage | total $ | count';
    const lines = [...byStage.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([stage, { total, count }]) => `${stage} | $${total.toFixed(4)} | ${count}`);
    return ['*Custos por stage (24h)*', '```', header, ...lines, '```'].join('\n');
  }

  private async formatRecentTurns(limit: number): Promise<string> {
    const entries = await this.readLogsFor(new Date());
    const finishes = entries.filter((e) => e.stage === 'turn_finish');
    const recent = finishes.slice(-limit);
    if (!recent.length) return 'Nenhum turno finalizado hoje.';
    const lines = recent.map((e) => {
      const cost = typeof e.cost_usd === 'number' ? e.cost_usd : 0;
      return `\`${e.turn_id ?? '?'}\` — ${e.latency_ms ?? 0}ms — $${cost.toFixed(4)}`;
    });
    return [`*Últimos ${recent.length} turnos*`, ...lines].join('\n');
  }

  private async formatErrors(): Promise<string> {
    const entries = await this.readLogsFor(new Date());
    const errors = entries.filter((e) => e.level === 'error' || (e.error && e.error.trim()));
    if (!errors.length) return 'Nenhum erro registrado hoje.';
    const lines = errors.slice(-20).map((e) => {
      const err = e.error ?? e.stage;
      return `${e.ts} | ${e.stage} | ${String(err).slice(0, 120)}`;
    });
    return ['*Erros do dia*', '```', ...lines, '```'].join('\n');
  }

  private async formatLog(): Promise<string> {
    const entries = await this.readLogsSince(24);
    const last = entries.slice(-20).map(sanitizeEntry);
    if (!last.length) return 'Nenhuma entrada de log nas últimas 24h.';
    const lines = last.map(formatLogLine);
    return ['*Últimas entradas*', '```', ...lines, '```'].join('\n');
  }
}
