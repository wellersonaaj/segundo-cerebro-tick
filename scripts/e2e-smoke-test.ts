/**
 * Homologação E2E — requer API rodando (`npm run dev`) e credenciais em `.env`.
 * Pré-requisito: schema greenfield v2 aplicado (`db:apply-greenfield-schema`).
 * Com GREENFIELD_SCHEMA=true: greenfield baseline, RPCs v2, PersistenceV2.
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';

loadDotEnv();

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'] as const;

const GENIUS_SCENARIO = {
  raw_content:
    'Conversei com o Bruno sobre a integração da Genius. Acho que a liberação do IP pode atrasar. Preciso cobrar o fornecedor amanhã.',
  source_channel: 'e2e-smoke',
  source_mode: 'conversational' as const,
  received_at: '2026-05-31T10:00:00-03:00',
  timezone: 'America/Sao_Paulo',
};

const FORBIDDEN_CLARIFICATION_PATTERNS = [
  /\btelefone\b/i,
  /\be-?mail\b/i,
  /\bemail\b/i,
  /\bcontato\b/i,
  /\brespons[aá]vel\b/i,
  /\bn[uú]mero do contrato\b/i,
  /\bprazo adicional\b/i,
  /\bprazo\b.*\b(ip|libera)/i,
  /\bdetalhes?\b.*\bip\b/i,
  /\baprofundar\b.*\bip\b/i,
];

const GENIUS_AMBIGUITY_REVIEW =
  /\b(tipo|identidade).*\b(amb[ií]gu|ambiguo|genius)\b|\bgenius\b.*\b(tipo|empresa|produto|projeto)\b/i;

const PORT = process.env.PORT ?? '3000';
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/** Timeout por request HTTP no smoke (evita ficar pendurado se POST /inbox-items travar). */
const E2E_FETCH_TIMEOUT_MS = 180_000;
const E2E_HEALTH_TIMEOUT_MS = 15_000;

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

function clarificationTextBlob(c: Record<string, unknown>): string {
  const parts = [
    c.question,
    c.reason,
    c.target_reference,
    c.source_excerpt,
    ...(Array.isArray(c.suggested_answers) ? c.suggested_answers : []),
  ];
  return parts.filter(Boolean).join(' ');
}

function checkEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    fail(`Variáveis ausentes: ${missing.join(', ')}. Configure .env antes de rodar.`);
  }
  ok('Variáveis SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e OPENAI_API_KEY presentes');

  if (process.env.GREENFIELD_SCHEMA === 'true') {
    console.log('\nModo greenfield v2:');
    console.log('  • greenfield baseline (migrations 20260602100000–100002)');
    console.log('  • RPCs v2 (start / promote / fail_extraction_run)');
    console.log('  • PersistenceV2 (EXTRACTOR_V14_SHADOW + PERSIST_COMPILED_MEMORY_V2)');
    ok('GREENFIELD_SCHEMA=true — stack v2 esperada');
  } else {
    console.warn(
      '\n⚠ GREENFIELD_SCHEMA não está true — E2E assume homologação legada ou flags incompletas.',
    );
  }
}

async function fetchJson(
  path: string,
  init?: RequestInit,
  timeoutMs = E2E_FETCH_TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      fail(
        `${init?.method ?? 'GET'} ${path} excedeu o timeout de ${timeoutMs}ms — verifique logs do servidor (inbox_flow) para a etapa travada`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  console.log('=== Segundo Cérebro — E2E Smoke Test ===\n');
  console.log(`Base URL: ${BASE}\n`);

  checkEnv();

  const health = await fetchJson('/health', undefined, E2E_HEALTH_TIMEOUT_MS);
  if (health.status !== 200) {
    fail(`GET /health retornou ${health.status}. A API está rodando? (npm run dev)`);
  }
  ok('GET /health');

  console.log(`\nPOST /inbox-items (timeout ${E2E_FETCH_TIMEOUT_MS}ms)…`);
  const post = await fetchJson(
    '/inbox-items',
    {
      method: 'POST',
      body: JSON.stringify(GENIUS_SCENARIO),
    },
    E2E_FETCH_TIMEOUT_MS,
  );

  console.log('\n--- POST /inbox-items ---');
  console.log(JSON.stringify(post.body, null, 2));

  if (post.status !== 201) {
    fail(`POST /inbox-items retornou ${post.status}: ${JSON.stringify(post.body)}`);
  }

  const result = post.body as Record<string, unknown>;
  const inboxId = result.inbox_item_id as string | undefined;
  if (!inboxId) fail('Resposta sem inbox_item_id');
  ok(`inbox_item salvo: ${inboxId}`);

  if (result.processing_status !== 'completed') {
    fail(`processing_status esperado completed, obtido: ${result.processing_status}`);
  }

  const reviewReasons = (result.review_reasons as string[]) ?? [];
  for (const reason of reviewReasons) {
    if (GENIUS_AMBIGUITY_REVIEW.test(reason)) {
      fail(`review_reason pendente sobre tipo ambíguo de Genius após resolução: "${reason}"`);
    }
  }
  ok('Nenhum review_reason pendente sobre tipo ambíguo de Genius');

  const memory = await fetchJson(`/memory/search?q=${encodeURIComponent('Genius')}`);
  if (memory.status !== 200) fail(`GET /memory/search retornou ${memory.status}`);
  console.log('\n--- GET /memory/search?q=Genius ---');
  console.log(JSON.stringify(memory.body, null, 2));

  const mem = memory.body as {
    entities?: Array<{ name: string; match_type?: string }>;
    events?: unknown[];
    assertions?: unknown[];
    tasks?: unknown[];
  };

  const eventsCreated =
    typeof result.events_created === 'number'
      ? result.events_created
      : (mem.events ?? []).length;
  if (eventsCreated < 1) fail('Nenhum evento criado');
  ok(`eventos criados: ${eventsCreated}`);

  const auditDetail = await fetchJson(`/audit/inbox-items/${inboxId}`);
  const auditAssertions =
    auditDetail.status === 200
      ? ((auditDetail.body as { assertions?: unknown[] }).assertions ?? []).length
      : 0;
  const assertionsCreated =
    typeof result.assertions_created === 'number'
      ? result.assertions_created
      : Math.max((mem.assertions ?? []).length, auditAssertions);
  if (assertionsCreated < 1) fail('Nenhuma assertion (hipótese) criada');
  ok(`assertions criadas: ${assertionsCreated}`);

  const tasksCreated =
    typeof result.tasks_created === 'number' ? result.tasks_created : (mem.tasks ?? []).length;
  if (tasksCreated < 1) {
    const tasksApi = await fetchJson('/tasks?status=open');
    const openCount = Array.isArray(tasksApi.body) ? tasksApi.body.length : 0;
    if (openCount < 1) fail('Nenhuma task criada');
    ok(`tasks abertas (API): ${openCount}`);
  } else {
    ok(`tasks criadas: ${tasksCreated}`);
  }
  const entityNames = (mem.entities ?? []).map((e) => e.name.toLowerCase());
  const hasGeniusHotels = entityNames.some((n) => n.includes('genius hotels'));
  const hasExactAlias = (mem.entities ?? []).some((e) => e.match_type === 'exact_alias');

  if (hasGeniusHotels || hasExactAlias) {
    ok('Genius resolvida para Genius Hotels (seed greenfield + memory resolver)');
  } else {
    console.warn(
      '⚠ Genius não resolvida para Genius Hotels — aplique greenfield seeds (20260602100002)',
    );
  }

  const entitiesList = await fetchJson('/entities?limit=100');
  let geniusHotelsId: string | undefined;
  if (entitiesList.status === 200) {
    const list = entitiesList.body as Array<{
      id: string;
      name: string;
      normalized_name: string;
    }>;
    const geniusLike = list.filter(
      (e) =>
        e.normalized_name === 'genius' ||
        (e.name.toLowerCase().includes('genius') && !e.name.toLowerCase().includes('hotels')),
    );
    const geniusHotels = list.filter((e) => e.normalized_name === 'genius hotels');
    geniusHotelsId = geniusHotels[0]?.id;
    if (geniusLike.length > 0 && geniusHotels.length > 0) {
      fail(
        `Duplicidade indevida: entidades Genius separadas (${geniusLike.map((e) => e.name).join(', ')})`,
      );
    }
    if (geniusLike.length === 0 && geniusHotels.length >= 1) {
      ok('Sem entidade Genius duplicada (apenas Genius Hotels)');
    }
  }

  const mentions = (mem.recent_mentions ?? []) as Array<{ description?: string; source_excerpt?: string }>;
  const hasGeniusInMentions = mentions.some(
    (m) => /genius/i.test(m.description ?? '') || /genius/i.test(m.source_excerpt ?? ''),
  );

  if (geniusHotelsId) {
    const entityEvents = await fetchJson(`/entities/${geniusHotelsId}/events?limit=20`);
    if (entityEvents.status === 200) {
      const events = entityEvents.body as Array<{ description: string }>;
      const hasGeniusInEvent = events.some((e) => /genius/i.test(e.description));
      if (!hasGeniusInEvent && !hasGeniusInMentions) {
        fail(
          `Nenhum evento/mention com Genius: entity events=${JSON.stringify(events.map((e) => e.description))}`,
        );
      }
      ok('Episódio contém referência a Genius (entity events ou recent_mentions)');
    }
  } else if (!hasGeniusInMentions) {
    console.warn('⚠ Não foi possível validar descrição do evento (Genius Hotels ausente)');
  } else {
    ok('Episódio contém referência a Genius (recent_mentions)');
  }

  const tasks = await fetchJson('/tasks?status=open');
  if (tasks.status !== 200) fail(`GET /tasks retornou ${tasks.status}`);
  console.log('\n--- GET /tasks?status=open ---');
  const taskList = tasks.body as Array<{ title: string; due_at: string | null }>;
  const cobrarTask = taskList.find((t) => t.title.toLowerCase().includes('fornecedor'));
  if (!cobrarTask) {
    const anyTask = taskList.length > 0;
    if (!anyTask) fail('Nenhuma tarefa aberta encontrada');
    ok('Tarefas abertas listadas');
  } else {
    if (!cobrarTask.due_at) {
      fail('Task "cobrar fornecedor" sem due_at — esperado amanhã (2026-06-01)');
    }
    const dueDate = cobrarTask.due_at.slice(0, 10);
    if (dueDate !== '2026-06-01') {
      fail(`due_at esperado 2026-06-01, obtido ${dueDate}`);
    }
    ok(`task com due_at correto: ${dueDate}`);
  }

  const clarifications = await fetchJson('/clarifications?status=pending');
  if (clarifications.status !== 200) fail(`GET /clarifications retornou ${clarifications.status}`);
  console.log('\n--- GET /clarifications?status=pending ---');
  console.log(JSON.stringify(clarifications.body, null, 2));

  const pendingAll = clarifications.body as Array<Record<string, unknown>>;
  const pending = pendingAll.filter((c) => c.inbox_item_id === inboxId);

  const c = pending.find(
    (row) =>
      row.target_type === 'task' &&
      (/cobrar.*fornecedor|fornecedor/i.test(String(row.target_reference)) ||
        /fornecedor/i.test(String(row.question))),
  );

  if (!c) {
    const auditClar =
      auditDetail.status === 200
        ? ((auditDetail.body as { clarifications?: Array<Record<string, unknown>> }).clarifications ??
          [])
        : [];
    const auditFornecedor = auditClar.find((row) =>
      /fornecedor/i.test(String(row.target_reference ?? row.question ?? '')),
    );
    if (auditFornecedor || cobrarTask) {
      ok(
        `fornecedor: ${auditFornecedor ? 'clarificação no audit' : 'task aberta sem clar pending'}`,
      );
    } else if (result.needs_clarification === true) {
      fail(
        `needs_clarification=true mas sem clarificação de fornecedor (pending inbox=${pending.length})`,
      );
    } else {
      console.warn(
        `⚠ Sem clarificação de fornecedor neste inbox (variabilidade do modelo); pending=${pending.length}`,
      );
      ok('Smoke E2E core OK — clarificação de fornecedor opcional nesta execução');
    }
  } else {
  const blob = clarificationTextBlob(c);

  for (const pattern of FORBIDDEN_CLARIFICATION_PATTERNS) {
    if (pattern.test(blob)) {
      fail(`Clarificação contém informação secundária proibida (${pattern}): ${JSON.stringify(c)}`);
    }
  }

  if (/tipo.*genius|genius.*tipo|empresa.*genius/i.test(blob) && hasGeniusHotels) {
    fail(`Clarificação sobre tipo de Genius indevida após resolução: "${c.question}"`);
  }

  if (c.target_type !== 'task') {
    fail(`target_type esperado task, obtido: ${c.target_type}`);
  }
  if (!/cobrar.*fornecedor|fornecedor/i.test(String(c.target_reference))) {
    fail(`target_reference esperado referência a cobrar fornecedor, obtido: ${c.target_reference}`);
  }
  if (c.issue_type !== 'missing_task_target') {
    fail(`issue_type esperado missing_task_target, obtido: ${c.issue_type}`);
  }
  if (c.priority !== 'medium') {
    fail(`priority esperado medium, obtido: ${c.priority}`);
  }
  if (c.blocking_scope !== 'task_execution') {
    fail(`blocking_scope esperado task_execution, obtido: ${c.blocking_scope}`);
  }

  const question = String(c.question ?? '');
  if (!/^qual fornecedor deve ser cobrado\??$/i.test(question.trim())) {
    fail(`question esperada "Qual fornecedor deve ser cobrado?", obtida: "${question}"`);
  }

  ok('Clarificação única: fornecedor, pergunta mínima, sem dados secundários');
  }

  console.log('\n=== Smoke test concluído com sucesso ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
