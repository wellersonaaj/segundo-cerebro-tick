import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appendFileMock = vi.fn(async () => {});
const mkdirMock = vi.fn(async () => {});

vi.mock('node:fs/promises', () => ({
  appendFile: (...args: unknown[]) => appendFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  stat: vi.fn(async () => ({ isDirectory: () => true })),
}));

describe('structured-logger', () => {
  beforeEach(() => {
    appendFileMock.mockClear();
    mkdirMock.mockClear();
    process.env.LOG_DIR = '/tmp/cerebro-logs-test';
  });

  afterEach(() => {
    delete process.env.LOG_DIR;
    vi.restoreAllMocks();
  });

  it('stage with async function records latency_ms', async () => {
    const { startTurn } = await import('../../src/utils/structured-logger.js');
    const turn = startTurn({ turn_id: randomUUID() });
    const entry = await turn.stage('parse', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { output: { ok: true } };
    });
    expect(entry.latency_ms).toBeGreaterThanOrEqual(0);
    expect(entry.stage).toBe('parse');
  });

  it('stage with static object records output', async () => {
    const { startTurn } = await import('../../src/utils/structured-logger.js');
    const turn = startTurn({ turn_id: randomUUID() });
    const entry = await turn.stage('thread_resolve', { output: { thread_id: 't-1' } });
    expect(entry.output).toEqual({ thread_id: 't-1' });
  });

  it('finish accumulates cost_usd from stages', async () => {
    const { startTurn } = await import('../../src/utils/structured-logger.js');
    const turn = startTurn({ turn_id: randomUUID() });
    await turn.stage('intent_classify', {
      model: 'gpt-5-mini',
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    const finished = await turn.finish();
    expect(finished.cost_usd).toBe(0.25);
    expect(turn.totalCost()).toBe(0.25);
  });

  it('stage throw re-throws and logs level=error', async () => {
    const { startTurn } = await import('../../src/utils/structured-logger.js');
    const turn = startTurn({ turn_id: randomUUID() });
    await expect(
      turn.stage('extraction', async () => {
        throw new Error('pipeline failed');
      }),
    ).rejects.toThrow('pipeline failed');
    const entries = turn.entries();
    expect(entries[0]?.level).toBe('error');
    expect(entries[0]?.error).toBe('pipeline failed');
  });

  it('estimateCostUsd for gpt-5-mini', async () => {
    const { estimateCostUsd } = await import('../../src/utils/structured-logger.js');
    expect(estimateCostUsd('gpt-5-mini', 1_000_000, 0)).toBe(0.25);
    expect(estimateCostUsd('gpt-5-mini', 0, 1_000_000)).toBe(2);
  });

  it('estimateCostUsd returns 0 for unknown model', async () => {
    const { estimateCostUsd } = await import('../../src/utils/structured-logger.js');
    expect(estimateCostUsd('unknown-model', 1000, 1000)).toBe(0);
  });

  it('writes JSON lines to LOG_DIR via appendFile', async () => {
    const { startTurn } = await import('../../src/utils/structured-logger.js');
    const turn = startTurn({ turn_id: randomUUID(), message_id: 42 });
    await turn.stage('parse', { output: { ok: true } });
    await turn.finish();
    expect(appendFileMock).toHaveBeenCalled();
    const written = appendFileMock.mock.calls.map((c) => String(c[1])).join('');
    expect(written).toContain('"stage":"parse"');
    expect(written).toContain('"message_id":42');
    expect(written).toContain('"stage":"turn_finish"');
  });
});
