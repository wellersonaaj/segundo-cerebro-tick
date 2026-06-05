import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandHandlerService } from '../src/services/command-handler.service.js';

describe('CommandHandlerService cost tracking', () => {
  let logDir: string;
  let service: CommandHandlerService;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), 'cerebro-cost-'));
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

  it('/status sums cost from individual stages, not only turn_finish', async () => {
    await writeTodayLog([
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'turn_finish',
        turn_id: 'a',
        latency_ms: 100,
        cost_usd: 0,
      },
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'intent_classify',
        turn_id: 'a',
        cost_usd: 0.001,
      },
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'extraction',
        turn_id: 'a',
        cost_usd: 0.004,
      },
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'turn_finish',
        turn_id: 'b',
        latency_ms: 200,
        cost_usd: 0,
      },
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'intent_classify',
        turn_id: 'b',
        cost_usd: 0.002,
      },
    ]);
    const res = await service.handle('/status', [], { turn_id: 't-1', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('turns: 2');
    expect(res.text).toContain('cost_usd: $0.0070');
    expect(res.reply_markup).toBeDefined();
  });

  it('/costs includes stage costs when turn_finish is zero', async () => {
    await writeTodayLog([
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'composer',
        turn_id: 'a',
        cost_usd: 0.003,
      },
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'verifier',
        turn_id: 'a',
        cost_usd: 0.0015,
      },
      {
        ts: new Date().toISOString(),
        level: 'info',
        stage: 'turn_finish',
        turn_id: 'a',
        cost_usd: 0,
      },
    ]);
    const res = await service.handle('/costs', [], { turn_id: 't-1', chat_id: 1, user_id: 1 });
    expect(res.text).toContain('composer | $0.0030 | 1');
    expect(res.text).toContain('verifier | $0.0015 | 1');
    expect(res.text).not.toContain('turn_finish');
  });
});
