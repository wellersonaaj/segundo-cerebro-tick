/**
 * Homologação MCP read-only (stdio).
 * Pré-requisito: ALLOW_TEST_DATA_RESET=true npm run reset:test-data && npm run test:e2e:smoke
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENIUS_HOTELS_ENTITY_ID,
  fail,
  ok,
  requireEnv,
} from './lib/homolog-helpers.js';

const FORBIDDEN_CLARIFICATION_BLOB =
  /\b(contato|telefone|e-?mail|email|respons[aá]vel|contrato|prazo adicional)\b/i;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

function parseToolResult(result: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): unknown {
  if (result.isError) {
    fail(`MCP tool error: ${result.content[0]?.text ?? 'unknown'}`);
  }
  const text = result.content.find((c) => c.type === 'text')?.text;
  if (!text) fail('MCP tool retornou conteúdo vazio');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(`MCP tool retornou JSON inválido: ${text.slice(0, 200)}`);
  }
}

async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const raw = await client.callTool({ name, arguments: args });
  return parseToolResult(raw) as T;
}

async function main(): Promise<void> {
  console.log('=== MCP Smoke Test (stdio) ===\n');
  console.log(
    'Pré-requisito: dados do cenário Genius (reset:test-data + test:e2e:smoke).\n',
  );

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/server.ts'],
    cwd: projectRoot,
    env: {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    } as Record<string, string>,
  });

  const client = new Client({ name: 'mcp-smoke-test', version: '0.1.0' });

  try {
    await client.connect(transport);

    const searchResult = await callTool<{
      matches: Array<{
        entity_id: string;
        name: string;
        match_type: string;
        confidence: number;
      }>;
    }>(client, 'search_entities', { query: 'Genius', entity_types: [], limit: 5 });

    const match = searchResult.matches[0];
    if (!match) fail('search_entities("Genius") não retornou matches');
    if (!match.name.toLowerCase().includes('genius hotels')) {
      fail(`search_entities: name esperado Genius Hotels, obtido: ${match.name}`);
    }
    if (match.match_type !== 'exact_alias') {
      fail(`search_entities: match_type esperado exact_alias, obtido: ${match.match_type}`);
    }
    if (match.confidence < 0.9) {
      fail(`search_entities: confidence esperado >= 0.90, obtido: ${match.confidence}`);
    }
    ok('search_entities("Genius") → Genius Hotels, exact_alias, confidence >= 0.90');

    const entityId = match.entity_id || GENIUS_HOTELS_ENTITY_ID;

    const details = await callTool<{
      entity: { name: string };
      aliases: string[];
    }>(client, 'get_entity_details', { entity_id: entityId });

    if (!details.entity?.name.toLowerCase().includes('genius hotels')) {
      fail(`get_entity_details: entidade inesperada: ${details.entity?.name}`);
    }
    if (!details.aliases.includes('Genius')) {
      fail(`get_entity_details: aliases esperado incluir "Genius", obtido: ${JSON.stringify(details.aliases)}`);
    }
    ok('get_entity_details → Genius Hotels + alias Genius');

    const mentions = await callTool<{
      mentions: Array<{ description: string; source_excerpt: string }>;
    }>(client, 'search_recent_mentions', { query: 'Genius', days: 90, limit: 10 });

    const mentionHit = (mentions.mentions ?? []).some(
      (m) =>
        /genius/i.test(m.description) ||
        /genius/i.test(m.source_excerpt) ||
        /genius hotels/i.test(m.description),
    );
    if (!mentionHit) {
      fail('search_recent_mentions("Genius") sem evento com Genius/Genius Hotels');
    }
    ok('search_recent_mentions("Genius") → evento com Genius');

    const memory = await callTool<{
      events: Array<{ description: string; source_excerpt: string }>;
      recent_mentions: Array<{ description: string; source_excerpt: string }>;
      entities: Array<{ name: string }>;
    }>(client, 'search_memory', {
      // ilike exige substring contígua; source_excerpt usa "integração da Genius"
      query: 'integração da Genius',
      limit: 10,
    });

    const memoryHit =
      (memory.events ?? []).some(
        (e) =>
          /genius/i.test(e.description) ||
          /genius/i.test(e.source_excerpt) ||
          /integra/i.test(e.description),
      ) ||
      (memory.recent_mentions ?? []).some(
        (m) => /genius/i.test(m.description) || /integra/i.test(m.source_excerpt),
      ) ||
      (memory.entities ?? []).some((e) => /genius/i.test(e.name));

    if (!memoryHit) {
      fail(
        `search_memory("integração da Genius") sem evento/entidade relacionado: ${JSON.stringify({
          events: memory.events?.length,
          mentions: memory.recent_mentions?.length,
          entities: memory.entities?.map((e) => e.name),
        })}`,
      );
    }
    ok('search_memory("integração da Genius") → evento relacionado');

    const tasks = await callTool<{
      tasks: Array<{ title: string; due_at: string | null }>;
    }>(client, 'list_open_tasks', { query: 'fornecedor', limit: 10 });

    const cobrar = (tasks.tasks ?? []).find((t) => /fornecedor/i.test(t.title));
    if (!cobrar) {
      fail('list_open_tasks("fornecedor") não retornou tarefa de cobrança');
    }
    const dueDate = cobrar.due_at?.slice(0, 10);
    if (dueDate !== '2026-06-01') {
      fail(`list_open_tasks: due_at esperado 2026-06-01, obtido ${dueDate ?? 'null'}`);
    }
    ok('list_open_tasks("fornecedor") → Cobrar o fornecedor, due_at 2026-06-01');

    const clarifications = await callTool<{
      clarifications: Array<Record<string, unknown>>;
    }>(client, 'list_pending_clarifications', { limit: 10 });

    const pending = clarifications.clarifications ?? [];
    const c = pending.find(
      (row) =>
        row.target_type === 'task' &&
        (/fornecedor/i.test(String(row.target_reference ?? '')) ||
          /fornecedor/i.test(String(row.question ?? ''))),
    );
    if (!c) {
      ok(
        `list_pending_clarifications: fornecedor não pending (${pending.length} itens — ok se clarification smoke já rodou)`,
      );
    } else {
    const question = String(c.question ?? '');
    if (!/fornecedor/i.test(question)) {
      fail(`question esperada sobre fornecedor, obtida: "${question}"`);
    }
    if (c.priority !== 'medium' && c.priority !== 'high') {
      fail(`priority esperado medium ou high, obtido: ${c.priority}`);
    }
    if (c.blocking_scope !== 'task_execution') {
      fail(`blocking_scope esperado task_execution, obtido: ${c.blocking_scope}`);
    }

    const blob = [
      c.question,
      c.reason,
      c.target_reference,
      ...(Array.isArray(c.suggested_answers) ? c.suggested_answers : []),
    ]
      .filter(Boolean)
      .join(' ');

    const forbiddenPattern =
      /fornecedor/i.test(String(c.target_reference ?? ''))
        ? /\b(telefone|e-?mail|email|contato|n[uú]mero do contrato|prazo adicional)\b/i
        : FORBIDDEN_CLARIFICATION_BLOB;
    if (forbiddenPattern.test(blob)) {
      fail(`list_pending_clarifications contém termo proibido no blob: ${blob}`);
    }
    ok('list_pending_clarifications → clarificação de fornecedor, sem dados secundários');
    }

    console.log('\n=== MCP smoke concluído com sucesso ===\n');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
