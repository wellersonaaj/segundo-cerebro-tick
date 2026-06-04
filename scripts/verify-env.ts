/**
 * Verifica se `.env` está salvo e se Supabase responde (schema greenfield v2).
 * Uso: npm run verify:env
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/config/env.js';

loadDotEnv();

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'] as const;

const VERIFY_ENV_PROBE_MARKER = '__verify_env_probe__';
const PROMOTE_PROBE_MARKER = '__verify_env_promote_probe__';

const PROMOTE_BLOCKING_SCOPE_FILTER = "blocking_scope in ('external_action')";

const HISTORICAL_PROMOTE_BLOCKING_SCOPE_FILTER =
  "blocking_scope in ('knowledge_confirmation', 'external_action')";

const MVP_PROCESSING_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

/** Colunas greenfield v2 — ausência de colunas legadas é verificada implicitamente. */
const SCHEMA_CHECKS: ReadonlyArray<{ table: string; columns: string; label: string }> = [
  {
    table: 'inbox_items',
    columns:
      'id, raw_content, source_channel, source_mode, source_reference, received_at, timezone, metadata, processing_status, active_extraction_run_id, latest_extraction_run_id, created_at, updated_at',
    label: 'inbox_items (greenfield)',
  },
  {
    table: 'inbox_extraction_runs',
    columns:
      'id, inbox_item_id, status, schema_version, prompt_version, extractor_version, model_name, normalizer_version, compiler_version, raw_model_output, parsed_output, compiled_output, error_message, started_at, finished_at, promoted_at, created_at',
    label: 'inbox_extraction_runs (greenfield)',
  },
  {
    table: 'task_mutations',
    columns:
      'id, task_id, inbox_item_id, extraction_run_id, operation, task_reference, title, record_status, due_at_literal, due_at_local_date, created_at',
    label: 'task_mutations (greenfield)',
  },
  {
    table: 'tasks',
    columns:
      'id, title, status, assignee_entity_id, project_entity_id, due_at_literal, due_at_local_date, due_at_status, created_at',
    label: 'tasks projection (greenfield)',
  },
  {
    table: 'assertions',
    columns:
      'id, inbox_item_id, extraction_run_id, assertion_kind, subject_reference, predicate, value_text, is_current, record_status, source_excerpt, created_at',
    label: 'assertions v2 (greenfield)',
  },
  {
    table: 'events',
    columns:
      'id, inbox_item_id, extraction_run_id, event_kind, title, occurred_at, episodic_confidence, record_status, source_excerpt, created_at',
    label: 'events v2 (greenfield)',
  },
  {
    table: 'clarification_requests',
    columns:
      'id, inbox_item_id, extraction_run_id, issue_type, materiality, normalized_target_reference, question, status, record_status, created_at',
    label: 'clarification_requests (greenfield)',
  },
  {
    table: 'entities',
    columns:
      'id, name, canonical_name, entity_type, normalized_name, registry_status, created_by_extraction_run_id, created_at',
    label: 'entities registry (greenfield — sem status legado)',
  },
  {
    table: 'entity_aliases',
    columns: 'id, entity_id, alias, normalized_alias, registry_status, created_at',
    label: 'entity_aliases (greenfield)',
  },
  {
    table: 'entity_alias_evidences',
    columns:
      'id, entity_alias_id, inbox_item_id, extraction_run_id, source_excerpt, source_block_reference, record_status, created_at',
    label: 'entity_alias_evidences (greenfield)',
  },
  {
    table: 'inbox_item_entities',
    columns:
      'id, inbox_item_id, extraction_run_id, entity_id, relation_type, record_status, source_block_reference, created_at',
    label: 'inbox_item_entities (greenfield)',
  },
  {
    table: 'assertion_entities',
    columns: 'id, assertion_id, entity_id, entity_reference, reference_role, resolution_status, created_at',
    label: 'assertion_entities (greenfield)',
  },
  {
    table: 'corrections',
    columns: 'id, inbox_item_id, correction_text, source_block_id, created_at',
    label: 'corrections (greenfield)',
  },
  {
    table: 'policies',
    columns: 'id, code, name, status, created_at',
    label: 'policies (greenfield)',
  },
];

const LEGACY_COLUMN_PROBES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'assertions', column: 'content' },
  { table: 'assertions', column: 'assertion_type' },
  { table: 'entities', column: 'status' },
  { table: 'events', column: 'event_type' },
  { table: 'tasks', column: 'inbox_item_id' },
];

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function checkTableSchema(
  supabase: SupabaseClient,
  check: { table: string; columns: string; label: string },
): Promise<void> {
  const { error } = await supabase.from(check.table).select(check.columns).limit(0);
  if (error?.code === '42P01') {
    fail(
      `Tabela ${check.table} ausente. Rode: ALLOW_GREENFIELD_SCHEMA_APPLY=true npm run db:apply-greenfield-schema`,
    );
  }
  if (error) {
    fail(`Schema ${check.label}: ${error.message}`);
  }
  console.log(`OK: ${check.label}`);
}

async function rejectLegacyColumns(supabase: SupabaseClient): Promise<void> {
  for (const { table, column } of LEGACY_COLUMN_PROBES) {
    const { error } = await supabase.from(table).select(column).limit(0);
    if (!error) {
      fail(
        `Coluna legada ${table}.${column} ainda presente — aplique schema greenfield (001–014 arquivadas).`,
      );
    }
  }
  console.log('OK: colunas legadas v1.3 ausentes (content, assertion_type, entities.status, …)');
}

async function checkInboxProcessingStatusConstraint(supabase: SupabaseClient): Promise<void> {
  const probeBase = {
    raw_content: VERIFY_ENV_PROBE_MARKER,
    source_channel: 'verify-env',
    source_mode: 'passive' as const,
    received_at: '2000-01-01T00:00:00Z',
    timezone: 'UTC',
  };

  const createdIds: string[] = [];

  const cleanup = async (): Promise<void> => {
    if (createdIds.length > 0) {
      await supabase.from('inbox_items').delete().in('id', createdIds);
    }
    await supabase
      .from('inbox_items')
      .delete()
      .eq('raw_content', VERIFY_ENV_PROBE_MARKER)
      .eq('source_channel', 'verify-env');
  };

  try {
    const { data: completedRow, error: completedErr } = await supabase
      .from('inbox_items')
      .insert({ ...probeBase, processing_status: 'completed' })
      .select('id')
      .single();

    if (completedErr) {
      fail(`Probe processing_status=completed falhou: ${completedErr.message}`);
    }
    if (completedRow?.id) createdIds.push(completedRow.id as string);

    const { data: processedRow, error: processedErr } = await supabase
      .from('inbox_items')
      .insert({ ...probeBase, processing_status: 'processed' })
      .select('id')
      .single();

    if (!processedErr) {
      if (processedRow?.id) createdIds.push(processedRow.id as string);
      fail('Banco aceita processing_status=processed (valor legado).');
    }

    console.log('OK: inbox_items.processing_status — completed aceito; processed rejeitado');
  } finally {
    await cleanup();
  }
}

async function checkExtractionRunRpcs(supabase: SupabaseClient): Promise<void> {
  const probeInboxId = '00000000-0000-0000-0000-000000000001';
  const probeRunId = '00000000-0000-0000-0000-000000000002';

  const probes: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
    {
      name: 'start_extraction_run',
      args: {
        p_inbox_item_id: probeInboxId,
        p_trigger_type: 'initial',
        p_schema_version: 'verify-env',
        p_prompt_version: 'verify-env',
        p_extractor_version: 'verify-env',
        p_model_name: 'verify-env',
        p_normalizer_version: '1.0.0',
        p_compiler_version: 'memory-compiler-v2',
      },
    },
    { name: 'promote_extraction_run', args: { p_run_id: probeRunId } },
    { name: 'fail_extraction_run', args: { p_run_id: probeRunId, p_error: 'verify-env probe' } },
  ];

  for (const { name, args } of probes) {
    const { error } = await supabase.rpc(name as 'start_extraction_run', args as never);
    const missing =
      error?.code === 'PGRST202' ||
      (error?.message.includes('Could not find the function') ?? false);
    if (missing) {
      fail(`RPC ${name} ausente. Rode db:apply-greenfield-schema.`);
    }
    console.log(`OK: RPC ${name} registrada`);
  }
}

function checkPromoteBlockingScopeDefinitionInRepo(): void {
  const historicalSql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260602100001_greenfield_rpcs.sql'),
    'utf8',
  );
  if (!historicalSql.includes(HISTORICAL_PROMOTE_BLOCKING_SCOPE_FILTER)) {
    fail(
      'Migration histórica 20260602100001 deve preservar filtro blocking_scope ' +
        'knowledge_confirmation + external_action.',
    );
  }

  const incrementalPath = join(
    process.cwd(),
    'supabase/migrations/20260603120000_s1_simplify_promote_blocking_scope.sql',
  );
  const incrementalSql = readFileSync(incrementalPath, 'utf8');
  if (!incrementalSql.includes(PROMOTE_BLOCKING_SCOPE_FILTER)) {
    fail(
      'Migration incremental S1 deve aplicar promote_extraction_run com filtro ' +
        'blocking_scope apenas external_action.',
    );
  }
  if (incrementalSql.includes(HISTORICAL_PROMOTE_BLOCKING_SCOPE_FILTER)) {
    fail('Migration incremental S1 não deve repetir o filtro histórico KC+EA.');
  }

  const s2Path = join(
    process.cwd(),
    'supabase/migrations/20260603130000_s2_external_action_no_promote_block.sql',
  );
  const s2Sql = readFileSync(s2Path, 'utf8');
  if (!s2Sql.includes('S2: external_action bloqueia execução futura, não ingestão ou promoção da memória')) {
    fail('Migration incremental S2 deve conter comentário canônico S2.');
  }
  if (s2Sql.includes(PROMOTE_BLOCKING_SCOPE_FILTER)) {
    fail('Migration incremental S2 não deve conter gate blocking_scope external_action.');
  }
  if (s2Sql.includes('BLOCKING_CLARIFICATIONS')) {
    fail('Migration incremental S2 não deve conter BLOCKING_CLARIFICATIONS.');
  }

  console.log(
    'OK: promote_extraction_run (repo) — histórico KC+EA; S1 EA gate; S2 sem gate promote',
  );
}

async function cleanupPromoteProbe(
  supabase: SupabaseClient,
  inboxId: string,
  taskIds: string[] = [],
): Promise<void> {
  await supabase.from('clarification_requests').delete().eq('inbox_item_id', inboxId);
  await supabase.from('task_mutations').delete().eq('inbox_item_id', inboxId);
  await supabase.from('inbox_extraction_runs').delete().eq('inbox_item_id', inboxId);
  await supabase
    .from('inbox_items')
    .update({ active_extraction_run_id: null, latest_extraction_run_id: null })
    .eq('id', inboxId);
  await supabase.from('inbox_items').delete().eq('id', inboxId);
  if (taskIds.length > 0) {
    await supabase.from('tasks').delete().in('id', taskIds);
  }
}

async function setupPromoteProbeRun(
  supabase: SupabaseClient,
): Promise<{ inboxId: string; runId: string }> {
  const inboxId = randomUUID();
  const { error: inboxErr } = await supabase.from('inbox_items').insert({
    id: inboxId,
    raw_content: PROMOTE_PROBE_MARKER,
    source_channel: 'verify-env',
    source_mode: 'passive',
    received_at: '2000-01-01T00:00:00Z',
    timezone: 'UTC',
    processing_status: 'pending',
  });
  if (inboxErr) {
    fail(`Probe promote: falha ao criar inbox_item: ${inboxErr.message}`);
  }

  const { data: startData, error: startErr } = await supabase.rpc('start_extraction_run', {
    p_inbox_item_id: inboxId,
    p_trigger_type: 'initial',
    p_schema_version: 'verify-env',
    p_prompt_version: 'verify-env',
    p_extractor_version: 'verify-env',
    p_model_name: 'verify-env',
    p_normalizer_version: '1.0.0',
    p_compiler_version: 'memory-compiler-v2',
  });
  if (startErr) {
    fail(`Probe promote: start_extraction_run falhou: ${startErr.message}`);
  }

  const runId = (startData as { run_id?: string } | null)?.run_id;
  if (!runId) {
    fail('Probe promote: start_extraction_run não retornou run_id');
  }

  const { error: validateErr } = await supabase
    .from('inbox_extraction_runs')
    .update({ status: 'validated', finished_at: new Date().toISOString() })
    .eq('id', runId);
  if (validateErr) {
    fail(`Probe promote: falha ao validar run: ${validateErr.message}`);
  }

  return { inboxId, runId };
}

async function insertBlockingClarificationCandidate(
  supabase: SupabaseClient,
  input: {
    inboxId: string;
    runId: string;
    blockingScope: 'task_execution' | 'knowledge_confirmation' | 'external_action';
    issueType?: string;
  },
): Promise<string> {
  const clarificationId = randomUUID();
  const issueType =
    input.issueType ??
    (input.blockingScope === 'task_execution'
      ? 'missing_task_target'
      : input.blockingScope === 'external_action'
        ? 'missing_external_action_target'
        : 'ambiguous_entity_type');

  const { error } = await supabase.from('clarification_requests').insert({
    id: clarificationId,
    inbox_item_id: input.inboxId,
    extraction_run_id: input.runId,
    target_type: 'task',
    target_reference: 'Cobrar fornecedor verify-env',
    normalized_target_reference: 'cobrar fornecedor verify-env',
    issue_type: issueType,
    question: 'Qual fornecedor deve ser cobrado?',
    reason: PROMOTE_PROBE_MARKER,
    priority: 'medium',
    blocking_scope: input.blockingScope,
    materiality: 'blocking',
    suggested_answers: [],
    source_excerpt: PROMOTE_PROBE_MARKER,
    status: 'pending',
    record_status: 'candidate',
  });
  if (error) {
    fail(`Probe promote: falha ao inserir clarification (${input.blockingScope}): ${error.message}`);
  }
  return clarificationId;
}

async function checkPromoteBlockingScopeSemantics(supabase: SupabaseClient): Promise<void> {
  checkPromoteBlockingScopeDefinitionInRepo();

  {
    let inboxId = '';
    const taskIds: string[] = [];
    try {
      const setup = await setupPromoteProbeRun(supabase);
      inboxId = setup.inboxId;
      const { runId } = setup;

      const clarificationId = await insertBlockingClarificationCandidate(supabase, {
        inboxId,
        runId,
        blockingScope: 'task_execution',
      });

      const { data: promoteData, error: promoteErr } = await supabase.rpc('promote_extraction_run', {
        p_run_id: runId,
      });
      if (promoteErr) {
        fail(
          `Probe promote task_execution: promote deveria permitir, falhou: ${promoteErr.message}`,
        );
      }
      if (!promoteData) {
        fail('Probe promote task_execution: promote retornou vazio');
      }

      const { data: clarificationRow, error: clarErr } = await supabase
        .from('clarification_requests')
        .select('status, record_status')
        .eq('id', clarificationId)
        .single();
      if (clarErr) {
        fail(`Probe promote task_execution: falha ao ler clarification: ${clarErr.message}`);
      }
      if (clarificationRow?.status !== 'pending') {
        fail(
          `Probe promote task_execution: clarification deveria permanecer pending, obtido ${clarificationRow?.status}`,
        );
      }
      if (clarificationRow?.record_status !== 'active') {
        fail(
          `Probe promote task_execution: clarification deveria estar active, obtido ${clarificationRow?.record_status}`,
        );
      }

      const { data: runRow } = await supabase
        .from('inbox_extraction_runs')
        .select('status')
        .eq('id', runId)
        .single();
      if (runRow?.status !== 'promoted') {
        fail(`Probe promote task_execution: run deveria estar promoted, obtido ${runRow?.status}`);
      }

      console.log(
        'OK: promote_extraction_run — blocking_scope=task_execution permite promote; clarification pending',
      );
    } finally {
      if (inboxId) {
        await cleanupPromoteProbe(supabase, inboxId, taskIds);
      }
    }
  }

  {
    let inboxId = '';
    try {
      const setup = await setupPromoteProbeRun(supabase);
      inboxId = setup.inboxId;
      const { runId } = setup;

      await insertBlockingClarificationCandidate(supabase, {
        inboxId,
        runId,
        blockingScope: 'knowledge_confirmation',
      });

      const { error: promoteErr, data: promoteData } = await supabase.rpc(
        'promote_extraction_run',
        { p_run_id: runId },
      );
      if (promoteErr) {
        fail(
          `Probe promote knowledge_confirmation: promote deveria concluir (S1), erro: ${promoteErr.message}`,
        );
      }
      if (!promoteData) {
        fail('Probe promote knowledge_confirmation: promote retornou vazio');
      }

      const { data: runRow } = await supabase
        .from('inbox_extraction_runs')
        .select('status')
        .eq('id', runId)
        .single();
      if (runRow?.status !== 'promoted') {
        fail(
          `Probe promote knowledge_confirmation: run deveria estar promoted, obtido ${runRow?.status}`,
        );
      }

      console.log(
        'OK: promote_extraction_run — blocking_scope=knowledge_confirmation não bloqueia promote (S1)',
      );
    } finally {
      if (inboxId) {
        await cleanupPromoteProbe(supabase, inboxId);
      }
    }
  }

  {
    let inboxId = '';
    try {
      const setup = await setupPromoteProbeRun(supabase);
      inboxId = setup.inboxId;
      const { runId } = setup;

      const clarificationId = await insertBlockingClarificationCandidate(supabase, {
        inboxId,
        runId,
        blockingScope: 'external_action',
      });

      const { error: promoteErr, data: promoteData } = await supabase.rpc(
        'promote_extraction_run',
        { p_run_id: runId },
      );
      if (promoteErr) {
        fail(
          `Probe promote external_action: promote deveria concluir (S2), erro: ${promoteErr.message}`,
        );
      }
      if (!promoteData) {
        fail('Probe promote external_action: promote retornou vazio');
      }

      const { data: clarificationRow, error: clarErr } = await supabase
        .from('clarification_requests')
        .select('status, record_status')
        .eq('id', clarificationId)
        .single();
      if (clarErr) {
        fail(`Probe promote external_action: falha ao ler clarification: ${clarErr.message}`);
      }
      if (clarificationRow?.status !== 'pending') {
        fail(
          `Probe promote external_action: clarification deveria permanecer pending, obtido ${clarificationRow?.status}`,
        );
      }
      if (clarificationRow?.record_status !== 'active') {
        fail(
          `Probe promote external_action: clarification deveria estar active, obtido ${clarificationRow?.record_status}`,
        );
      }

      const { data: runRow } = await supabase
        .from('inbox_extraction_runs')
        .select('status')
        .eq('id', runId)
        .single();
      if (runRow?.status !== 'promoted') {
        fail(
          `Probe promote external_action: run deveria estar promoted, obtido ${runRow?.status}`,
        );
      }

      const { data: inboxRow } = await supabase
        .from('inbox_items')
        .select('processing_status, active_extraction_run_id')
        .eq('id', inboxId)
        .single();
      if (inboxRow?.processing_status !== 'completed') {
        fail(
          `Probe promote external_action: inbox deveria estar completed, obtido ${inboxRow?.processing_status}`,
        );
      }
      if (inboxRow?.active_extraction_run_id !== runId) {
        fail('Probe promote external_action: active_extraction_run_id deveria apontar para run promovida');
      }

      console.log(
        'OK: promote_extraction_run — blocking_scope=external_action não bloqueia promote (S2); clarification pending',
      );
    } finally {
      if (inboxId) {
        await cleanupPromoteProbe(supabase, inboxId);
      }
    }
  }
}

const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  fail(`Variáveis vazias: ${missing.join(', ')}. Salve o arquivo .env (Cmd+S) e preencha os valores.`);
}

let env;
try {
  env = loadEnv();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

console.log('OK: variáveis carregadas');
console.log('  SUPABASE_URL:', env.SUPABASE_URL);
console.log(
  '  GREENFIELD_SCHEMA:',
  process.env.GREENFIELD_SCHEMA === 'true' ? 'true' : 'false (defina true após apply-greenfield)',
);

const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
});

if (res.status === 401) {
  fail('Supabase rejeitou a secret key (HTTP 401).');
}
if (!res.ok) {
  fail(`Supabase respondeu HTTP ${res.status}`);
}
console.log('OK: Supabase autenticou (HTTP', res.status + ')');

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const check of SCHEMA_CHECKS) {
  await checkTableSchema(supabase, check);
}

await rejectLegacyColumns(supabase);
await checkInboxProcessingStatusConstraint(supabase);
await checkExtractionRunRpcs(supabase);
await checkPromoteBlockingScopeSemantics(supabase);

const { data: geniusSeed } = await supabase
  .from('entities')
  .select('id')
  .eq('normalized_name', 'genius hotels')
  .maybeSingle();
if (geniusSeed) {
  console.log('OK: seed Genius Hotels presente');
} else {
  console.warn('WARN: seed Genius ausente — db:apply-greenfield-schema inclui seeds');
}

console.log('\nTudo certo (greenfield v2). Homologação:');
console.log('  GREENFIELD_SCHEMA=true EXTRACTOR_V14_SHADOW_ENABLED=true PERSIST_COMPILED_MEMORY_V2=true');
console.log('  npm run dev && npm run test:e2e:smoke');
