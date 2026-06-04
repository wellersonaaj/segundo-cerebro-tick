import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_SOURCE_CHANNEL,
  BOOTSTRAP_SOURCE_MODE,
  BOOTSTRAP_TIMEZONE,
  BOOTSTRAP_USAGE,
  assertBootstrapImportAllowed,
  buildBootstrapPayload,
  parseBootstrapArgs,
  resolveBootstrapMaxChars,
  runBootstrapImport,
  validateMarkdownContent,
} from '../scripts/lib/bootstrap-import.js';

describe('bootstrap import', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function makeTempFile(content: string, name = 'memoria.md'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-import-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  it('parseBootstrapArgs rejects unknown flag', () => {
    expect(() => parseBootstrapArgs(['file.md', '--force'])).toThrow(/Argumento desconhecido/);
    expect(() => parseBootstrapArgs(['file.md', '--force'])).toThrow(BOOTSTRAP_USAGE);
  });

  it('parseBootstrapArgs rejects multiple file paths', () => {
    expect(() => parseBootstrapArgs(['a.md', 'b.md'])).toThrow(/Apenas um arquivo/);
    expect(() => parseBootstrapArgs(['a.md', 'b.md'])).toThrow(BOOTSTRAP_USAGE);
  });

  it('parseBootstrapArgs rejects repeated --dry-run flag', () => {
    expect(() => parseBootstrapArgs(['file.md', '--dry-run', '--dry-run'])).toThrow(
      /Flag --dry-run repetida/,
    );
    expect(() => parseBootstrapArgs(['file.md', '--dry-run', '--dry-run'])).toThrow(BOOTSTRAP_USAGE);
  });

  it('assertBootstrapImportAllowed aborts when ALLOW_BOOTSTRAP_IMPORT is missing', () => {
    expect(() => assertBootstrapImportAllowed({})).toThrow(/ALLOW_BOOTSTRAP_IMPORT=true/);
  });

  it('validateMarkdownContent rejects empty file', () => {
    expect(() => validateMarkdownContent('')).toThrow(/vazio ou sem conteúdo útil/);
    expect(() => validateMarkdownContent('   \n\t  ')).toThrow(/vazio ou sem conteúdo útil/);
  });

  it('buildBootstrapPayload returns all five expected fields', () => {
    const now = new Date('2026-05-31T13:00:00.000Z');
    const content = '  conteúdo\n\ncom quebras  ';
    const payload = buildBootstrapPayload(content, now);

    expect(Object.keys(payload).sort()).toEqual([
      'raw_content',
      'received_at',
      'source_channel',
      'source_mode',
      'timezone',
    ]);
    expect(payload.raw_content).toBe(content);
    expect(payload.received_at).toBe(now.toISOString());
  });

  it('buildBootstrapPayload uses source_channel bootstrap', () => {
    expect(buildBootstrapPayload('x').source_channel).toBe(BOOTSTRAP_SOURCE_CHANNEL);
    expect(buildBootstrapPayload('x').source_channel).toBe('bootstrap');
  });

  it('buildBootstrapPayload uses source_mode passive', () => {
    expect(buildBootstrapPayload('x').source_mode).toBe(BOOTSTRAP_SOURCE_MODE);
    expect(buildBootstrapPayload('x').source_mode).toBe('passive');
  });

  it('buildBootstrapPayload uses timezone America/Sao_Paulo', () => {
    expect(buildBootstrapPayload('x').timezone).toBe(BOOTSTRAP_TIMEZONE);
    expect(buildBootstrapPayload('x').timezone).toBe('America/Sao_Paulo');
  });

  it('validateMarkdownContent preserves raw_content including whitespace and newlines', () => {
    const raw = '\n  linha 1\n\n  linha 2  \n';
    expect(validateMarkdownContent(raw)).toBe(raw);
  });

  it('resolveBootstrapMaxChars uses default, accepts valid env and rejects invalid values', () => {
    expect(resolveBootstrapMaxChars({})).toBe(50_000);
    expect(resolveBootstrapMaxChars({ BOOTSTRAP_MAX_CHARS: '12000' })).toBe(12_000);
    expect(() => resolveBootstrapMaxChars({ BOOTSTRAP_MAX_CHARS: 'abc' })).toThrow(
      /BOOTSTRAP_MAX_CHARS inválido/,
    );
    expect(() => resolveBootstrapMaxChars({ BOOTSTRAP_MAX_CHARS: '0' })).toThrow(
      /BOOTSTRAP_MAX_CHARS inválido/,
    );
    expect(() => resolveBootstrapMaxChars({ BOOTSTRAP_MAX_CHARS: '-10' })).toThrow(
      /BOOTSTRAP_MAX_CHARS inválido/,
    );
  });

  it('runBootstrapImport dry-run does not call API', async () => {
    const filePath = makeTempFile('# Panorama\n\nConteúdo.');
    const fetchFn = vi.fn();
    const logs: string[] = [];

    await runBootstrapImport({
      filePath,
      dryRun: true,
      env: { ALLOW_BOOTSTRAP_IMPORT: 'true' },
      fetchFn,
      logFn: (msg) => logs.push(msg),
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('raw_content.length:'))).toBe(true);
  });

  it('runBootstrapImport GET /health without body and POST /inbox-items with Content-Type', async () => {
    const filePath = makeTempFile('# Panorama\n\nConteúdo.');
    const calls: Array<{ path: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
    const fetchFn = vi.fn(async (p: string, init?: RequestInit) => {
      calls.push({ path: p, init: init as { method?: string; headers?: Record<string, string>; body?: string } });
      if (p === '/health') {
        return { status: 200, body: { status: 'ok' } };
      }
      return {
        status: 201,
        body: { inbox_item_id: 'id-1', processing_status: 'completed' },
      };
    });

    await runBootstrapImport({
      filePath,
      dryRun: false,
      env: { ALLOW_BOOTSTRAP_IMPORT: 'true' },
      fetchFn,
      logFn: () => {},
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      path: '/health',
      init: { method: 'GET' },
    });
    expect(calls[0]?.init?.method).not.toBe('POST');
    expect(calls[0]?.init?.body).toBeUndefined();

    expect(calls[1]?.path).toBe('/inbox-items');
    expect(calls[1]?.path).not.toBe('/health');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(typeof calls[1]?.init?.body).toBe('string');
  });

  it('runBootstrapImport fails when file does not exist', async () => {
    const failFn = vi.fn((message: string): never => {
      throw new Error(message);
    });

    await expect(
      runBootstrapImport({
        filePath: path.join(os.tmpdir(), 'bootstrap-missing-file.md'),
        dryRun: true,
        env: { ALLOW_BOOTSTRAP_IMPORT: 'true' },
        failFn,
      }),
    ).rejects.toThrow(/não encontrado/);

    expect(failFn).toHaveBeenCalled();
  });

  it('runBootstrapImport fails when content exceeds BOOTSTRAP_MAX_CHARS', async () => {
    const filePath = makeTempFile('x'.repeat(20));
    const failFn = vi.fn((message: string): never => {
      throw new Error(message);
    });

    await expect(
      runBootstrapImport({
        filePath,
        dryRun: true,
        env: { ALLOW_BOOTSTRAP_IMPORT: 'true' },
        maxChars: 10,
        failFn,
      }),
    ).rejects.toThrow(/excede o limite de 10 caracteres/);

    expect(failFn).toHaveBeenCalled();
  });

  it('runBootstrapImport fails with readable message when API is unavailable', async () => {
    const filePath = makeTempFile('# Panorama\n\nConteúdo.');
    const fetchFn = vi.fn(async () => ({ status: 503, body: { error: 'unavailable' } }));
    const failFn = vi.fn((message: string): never => {
      throw new Error(message);
    });

    await expect(
      runBootstrapImport({
        filePath,
        dryRun: false,
        env: { ALLOW_BOOTSTRAP_IMPORT: 'true' },
        fetchFn,
        failFn,
        logFn: () => {},
      }),
    ).rejects.toThrow(/API indisponível \(GET \/health → 503\)/);

    expect(fetchFn).toHaveBeenCalledWith('/health', { method: 'GET' }, 15_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
