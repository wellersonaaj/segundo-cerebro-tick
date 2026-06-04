import fs from 'node:fs';
import path from 'node:path';
import { fetchJson, HTTP_SMOKE_TIMEOUT_MS } from './homolog-helpers.js';

export const BOOTSTRAP_SOURCE_CHANNEL = 'bootstrap';
export const BOOTSTRAP_SOURCE_MODE = 'passive' as const;
export const BOOTSTRAP_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_BOOTSTRAP_MAX_CHARS = 50_000;
export const BOOTSTRAP_HEALTH_TIMEOUT_MS = 15_000;

export const BOOTSTRAP_BANNER = [
  '⚠️ IMPORTAÇÃO DE PANORAMA INICIAL',
  'O arquivo será processado pelo pipeline normal e poderá criar entidades,',
  'eventos, afirmações, tarefas e clarificações.',
].join('\n');

export const BOOTSTRAP_USAGE = 'Uso: npm run import:bootstrap -- <arquivo.md> [--dry-run]';

export interface BootstrapPayload {
  raw_content: string;
  source_channel: string;
  source_mode: typeof BOOTSTRAP_SOURCE_MODE;
  received_at: string;
  timezone: string;
}

export interface ParseBootstrapArgsResult {
  filePath: string;
  dryRun: boolean;
}

export interface RunBootstrapImportOptions {
  filePath: string;
  dryRun: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetchFn?: (
    path: string,
    init?: RequestInit,
    timeoutMs?: number,
  ) => Promise<{ status: number; body: unknown }>;
  readFileFn?: (filePath: string) => string;
  logFn?: (message: string) => void;
  failFn?: (message: string) => never;
  maxChars?: number;
}

export function parseBootstrapArgs(argv: readonly string[]): ParseBootstrapArgsResult {
  const positional: string[] = [];
  let dryRunCount = 0;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRunCount += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Argumento desconhecido: ${arg}\n${BOOTSTRAP_USAGE}`);
    }
    positional.push(arg);
  }

  if (dryRunCount > 1) {
    throw new Error(`Flag --dry-run repetida.\n${BOOTSTRAP_USAGE}`);
  }

  if (positional.length === 0) {
    throw new Error(`Caminho do arquivo Markdown é obrigatório.\n${BOOTSTRAP_USAGE}`);
  }

  if (positional.length > 1) {
    throw new Error(`Apenas um arquivo Markdown é permitido.\n${BOOTSTRAP_USAGE}`);
  }

  return { filePath: positional[0]!, dryRun: dryRunCount === 1 };
}

export function assertBootstrapImportAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.ALLOW_BOOTSTRAP_IMPORT !== 'true') {
    throw new Error(
      'Abortado: defina ALLOW_BOOTSTRAP_IMPORT=true para confirmar a importação do panorama inicial.',
    );
  }
}

export function resolveBootstrapMaxChars(
  env: NodeJS.ProcessEnv = process.env,
  override?: number,
): number {
  if (override !== undefined) {
    return override;
  }

  const raw = env.BOOTSTRAP_MAX_CHARS?.trim();
  if (!raw) {
    return DEFAULT_BOOTSTRAP_MAX_CHARS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `BOOTSTRAP_MAX_CHARS inválido: "${raw}". Use um inteiro positivo ou remova a variável para usar o padrão ${DEFAULT_BOOTSTRAP_MAX_CHARS}.`,
    );
  }

  return parsed;
}

export function validateMarkdownContent(content: string): string {
  if (content.trim().length === 0) {
    throw new Error('Arquivo Markdown vazio ou sem conteúdo útil.');
  }

  return content;
}

export function assertMarkdownSize(content: string, maxChars: number): void {
  const length = content.length;
  if (length > maxChars) {
    throw new Error(
      `Conteúdo excede o limite de ${maxChars} caracteres (atual: ${length}). Divida o panorama em arquivos menores e revisáveis antes de importar.`,
    );
  }
}

export function buildBootstrapPayload(content: string, now?: Date): BootstrapPayload {
  return {
    raw_content: content,
    source_channel: BOOTSTRAP_SOURCE_CHANNEL,
    source_mode: BOOTSTRAP_SOURCE_MODE,
    received_at: (now ?? new Date()).toISOString(),
    timezone: BOOTSTRAP_TIMEZONE,
  };
}

export function readBootstrapMarkdownFile(
  filePath: string,
  readFileFn: (path: string) => string = (p) => fs.readFileSync(p, 'utf8'),
): string {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Arquivo não encontrado: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Caminho não é um arquivo: ${resolved}`);
  }

  const content = readFileFn(resolved);
  return validateMarkdownContent(content);
}

function previewContent(content: string, maxLen = 120): string {
  if (content.length <= maxLen) {
    return content;
  }
  return `${content.slice(0, maxLen)}… (truncado)`;
}

export async function runBootstrapImport(options: RunBootstrapImportOptions): Promise<void> {
  const env = options.env ?? process.env;
  const logFn = options.logFn ?? console.log;
  const failFn =
    options.failFn ??
    ((message: string): never => {
      throw new Error(message);
    });

  try {
    assertBootstrapImportAllowed(env);
  } catch (err) {
    failFn(err instanceof Error ? err.message : String(err));
  }

  logFn(`\n${BOOTSTRAP_BANNER}\n`);

  let content = '';
  try {
    content = readBootstrapMarkdownFile(options.filePath, options.readFileFn);
    const maxChars = resolveBootstrapMaxChars(env, options.maxChars);
    assertMarkdownSize(content, maxChars);
  } catch (err) {
    failFn(err instanceof Error ? err.message : String(err));
  }

  const payload = buildBootstrapPayload(content, options.now);

  if (options.dryRun) {
    logFn('Modo dry-run — nenhuma chamada de rede será feita.\n');
    logFn('Resumo do payload:');
    logFn(`  source_channel: ${payload.source_channel}`);
    logFn(`  source_mode: ${payload.source_mode}`);
    logFn(`  timezone: ${payload.timezone}`);
    logFn(`  received_at: ${payload.received_at}`);
    logFn(`  raw_content.length: ${payload.raw_content.length} caracteres`);
    logFn(`  raw_content preview: ${previewContent(payload.raw_content)}`);
    return;
  }

  const fetchFn = options.fetchFn ?? fetchJson;

  const health = await fetchFn('/health', { method: 'GET' }, BOOTSTRAP_HEALTH_TIMEOUT_MS);
  if (health.status !== 200) {
    failFn(
      `API indisponível (GET /health → ${health.status}): ${JSON.stringify(health.body)}`,
    );
  }

  const post = await fetchFn(
    '/inbox-items',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    HTTP_SMOKE_TIMEOUT_MS,
  );

  if (post.status !== 201) {
    failFn(`POST /inbox-items retornou ${post.status}: ${JSON.stringify(post.body)}`);
  }

  logFn('\n--- Importação concluída ---');
  logFn(JSON.stringify(post.body, null, 2));
}
