import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntry } from '../utils/structured-logger.js';

export interface CommandHandlerContext {
  turn_id: string;
  chat_id: number;
  user_id: number;
}

export interface CommandHandlerResponse {
  text: string;
  parse_mode?: 'Markdown';
}

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

function sanitizeEntry(entry: LogEntry): LogEntry {
  const copy = { ...entry };
  for (const key of ['input', 'output'] as const) {
    const val = copy[key];
    if (typeof val === 'string' && val.length > 120) {
      copy[key] = `${val.slice(0, 117)}...`;
    } else if (val && typeof val === 'object') {
      copy[key] = JSON.parse(JSON.stringify(val, (_k, v) =>
        typeof v === 'string' && v.length > 120 ? `${v.slice(0, 117)}...` : v,
      ));
    }
  }
  return copy;
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
        return { text: await this.formatStatus(new Date()) };
      case '/debug':
        return { text: await this.formatDebug(args[0], ctx.turn_id) };
      case '/help':
        return { text: this.formatHelp() };
      case '/costs':
        return { text: await this.formatCosts() };
      case '/log':
        return { text: await this.formatLog() };
      default:
        return { text: `Comando desconhecido: ${command}\n\n${this.formatHelp()}` };
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

  private async formatStatus(date: Date): Promise<string> {
    const entries = await this.readLogsFor(date);
    const finishes = entries.filter((e) => e.stage === 'turn_finish');
    const latencies = finishes
      .map((e) => e.latency_ms)
      .filter((v): v is number => typeof v === 'number');
    const totalCost = finishes.reduce((sum, e) => sum + (typeof e.cost_usd === 'number' ? e.cost_usd : 0), 0);
    const p95 = percentile(latencies, 95);
    return [
      '*Status do dia*',
      `turns: ${finishes.length}`,
      `p95_latency: ${Math.round(p95)}ms`,
      `cost_usd: $${totalCost.toFixed(4)}`,
    ].join('\n');
  }

  private async formatDebug(turnIdArg: string | undefined, fallbackTurnId: string): Promise<string> {
    const turnId = turnIdArg?.trim() || fallbackTurnId;
    const today = await this.readLogsFor(new Date());
    const yesterday = await this.readLogsFor(new Date(Date.now() - 86_400_000));
    const matches = [...today, ...yesterday].filter((e) => e.turn_id === turnId);
    if (!matches.length) {
      return `Nenhum log encontrado para turn_id=${turnId}`;
    }
    const lines = matches.map(
      (e) =>
        `[${e.stage}] ${e.latency_ms ?? 0}ms` +
        (e.error ? ` err=${e.error}` : '') +
        (e.output ? ` out=${JSON.stringify(e.output).slice(0, 80)}` : ''),
    );
    return [`*Debug turn* \`${turnId}\``, ...lines].join('\n');
  }

  private formatHelp(): string {
    return [
      '*Comandos disponíveis*',
      '/status — turns, p95 e custo do dia',
      '/debug [turn_id] — stages do turn (último se omitido)',
      '/help — esta lista',
      '/costs — breakdown por stage (24h)',
      '/log — últimas 20 entradas (sanitizado)',
    ].join('\n');
  }

  private async formatCosts(): Promise<string> {
    const entries = await this.readLogsSince(24);
    const byStage = new Map<string, number>();
    for (const entry of entries) {
      const cost = typeof entry.cost_usd === 'number' ? entry.cost_usd : 0;
      if (cost <= 0) continue;
      byStage.set(entry.stage, (byStage.get(entry.stage) ?? 0) + cost);
    }
    if (!byStage.size) return 'Sem custos registrados nas últimas 24h.';
    const lines = [...byStage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([stage, cost]) => `${stage}: $${cost.toFixed(4)}`);
    return ['*Custos por stage (24h)*', ...lines].join('\n');
  }

  private async formatLog(): Promise<string> {
    const entries = await this.readLogsSince(24);
    const last = entries.slice(-20).map(sanitizeEntry);
    if (!last.length) return 'Nenhuma entrada de log nas últimas 24h.';
    return ['*Últimas entradas*', '```', JSON.stringify(last, null, 2), '```'].join('\n');
  }
}
