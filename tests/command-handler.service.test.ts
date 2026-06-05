import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandHandlerService } from '../src/services/command-handler.service.js';

describe('CommandHandlerService', () => {
  let logDir: string;
  let service: CommandHandlerService;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), 'cerebro-cmd-'));
    service = new CommandHandlerService(logDir);
  });

  afterEach(async () => {
    delete process.env.LOG_DIR;
  });

  async function writeTodayLog(entries: unknown[]): Promise<void> {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const file = join(logDir, `${y}-${m}-${d}.jsonl`);
    await mkdir(logDir, { recursive: true });
    await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }

  it('/help lists commands', async () => {
    const res = await service.handle('/help', [], {
      turn_id: 't-1',
      chat_id: 1,
      user_id: 1,
    });
    expect(res.text).toContain('/status');
    expect(res.text).toContain('/debug');
    expect(res.text).toContain('/costs');
    expect(res.text).toContain('/log');
  });

  it('/status aggregates turn_finish metrics and stage costs', async () => {
    await writeTodayLog([
      { ts: new Date().toISOString(), level: 'info', stage: 'turn_finish', turn_id: 'a', latency_ms: 100, cost_usd: 0.01 },
      { ts: new Date().toISOString(), level: 'info', stage: 'turn_finish', turn_id: 'b', latency_ms: 200, cost_usd: 0.02 },
      { ts: new Date().toISOString(), level: 'info', stage: 'extraction', turn_id: 'b', cost_usd: 0.005 },
    ]);
    const res = await service.handle('/status', [], { turn_id: 't-1', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('turns: 2');
    expect(res.text).toContain('cost_usd: $0.0350');
    expect(res.reply_markup?.inline_keyboard?.[0]).toHaveLength(3);
  });

  it('/debug filters by turn_id', async () => {
    await writeTodayLog([
      { ts: new Date().toISOString(), level: 'info', stage: 'parse', turn_id: 'abc', latency_ms: 5 },
      { ts: new Date().toISOString(), level: 'info', stage: 'extraction', turn_id: 'abc', latency_ms: 50 },
      { ts: new Date().toISOString(), level: 'info', stage: 'parse', turn_id: 'other', latency_ms: 1 },
    ]);
    const res = await service.handle('/debug', ['abc'], { turn_id: 'fallback', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('abc');
    expect(res.text).toContain('[parse]');
    expect(res.text).toContain('[extraction]');
    expect(res.text).not.toContain('other');
  });

  it('/costs sums by stage in last 24h', async () => {
    await writeTodayLog([
      { ts: new Date().toISOString(), level: 'info', stage: 'intent_classify', turn_id: 'a', cost_usd: 0.001 },
      { ts: new Date().toISOString(), level: 'info', stage: 'intent_classify', turn_id: 'b', cost_usd: 0.002 },
      { ts: new Date().toISOString(), level: 'info', stage: 'extraction', turn_id: 'c', cost_usd: 0.01 },
    ]);
    const res = await service.handle('/costs', [], { turn_id: 't-1', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('intent_classify');
    expect(res.text).toContain('extraction');
  });

  it('/debug uses last turn_finish when turn_id omitted', async () => {
    await writeTodayLog([
      { ts: new Date().toISOString(), level: 'info', stage: 'parse', turn_id: 'first', latency_ms: 5 },
      { ts: new Date().toISOString(), level: 'info', stage: 'turn_finish', turn_id: 'first', latency_ms: 50 },
      { ts: new Date().toISOString(), level: 'info', stage: 'parse', turn_id: 'last-turn', latency_ms: 7 },
      { ts: new Date().toISOString(), level: 'info', stage: 'turn_finish', turn_id: 'last-turn', latency_ms: 80 },
    ]);
    const res = await service.handle('/debug', [], { turn_id: 'fallback', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('last-turn');
    expect(res.text).not.toContain('first');
    expect(res.text).toContain('```');
  });

  it('/log returns formatted lines with stage and latency', async () => {
    const ts = new Date().toISOString();
    await writeTodayLog([
      {
        ts,
        level: 'info',
        stage: 'intent_classify',
        turn_id: 'a',
        latency_ms: 42,
        output: { intent: 'save' },
      },
    ]);
    const res = await service.handle('/log', [], { turn_id: 't-1', chat_id: 1, user_id: 1 });
    expect(res.text).toContain(`${ts} | intent_classify | 42ms | save`);
  });

  it('/log omits long input fields from formatted output', async () => {
    const long = 'x'.repeat(600);
    await writeTodayLog([
      { ts: new Date().toISOString(), level: 'info', stage: 'parse', turn_id: 'a', input: long },
    ]);
    const res = await service.handle('/log', [], { turn_id: 't-1', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('Últimas entradas');
    expect(res.text).not.toContain(long);
    expect(res.text).toMatch(/parse \| 0ms/);
  });
});
