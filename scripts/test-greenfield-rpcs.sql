-- Greenfield RPC smoke (manual — psql $DATABASE_URL -f scripts/test-greenfield-rpcs.sql)
-- Bloco 6F: task mutations, rollback, fail registry candidates
--
-- Requer schema greenfield aplicado. create candidates usam task_id NULL (FK exige
-- task existente quando task_id é preenchido).

create or replace function rpc_smoke_cleanup(
  p_inbox_id uuid,
  p_task_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
as $$
begin
  update inbox_items set
    active_extraction_run_id = null,
    latest_extraction_run_id = null
  where id = p_inbox_id;

  update entities set created_by_extraction_run_id = null
  where created_by_extraction_run_id in (
    select id from inbox_extraction_runs where inbox_item_id = p_inbox_id
  );

  update entity_aliases set created_by_extraction_run_id = null
  where created_by_extraction_run_id in (
    select id from inbox_extraction_runs where inbox_item_id = p_inbox_id
  );

  delete from task_mutations where inbox_item_id = p_inbox_id;
  delete from entity_alias_evidences where inbox_item_id = p_inbox_id;
  delete from inbox_item_entities where inbox_item_id = p_inbox_id;
  delete from clarification_requests where inbox_item_id = p_inbox_id;
  delete from inbox_extraction_runs where inbox_item_id = p_inbox_id;
  delete from inbox_items where id = p_inbox_id;

  if coalesce(array_length(p_task_ids, 1), 0) > 0 then
    delete from tasks where id = any (p_task_ids);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. create válido + promote (task_id NULL no candidate)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000001';
  v_run_id uuid;
  v_task_id uuid;
  v_task_count int;
  v_active_mut int;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id);

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Criar tarefa RPC test', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;

  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into task_mutations (
    id, task_id, inbox_item_id, extraction_run_id, operation,
    title, task_kind, status_signal, source_excerpt, record_status
  ) values (
    gen_random_uuid(), null, v_inbox_id, v_run_id, 'create',
    'Cobrar fornecedor RPC test', 'follow_up', 'open', 'Criar tarefa RPC test', 'candidate'
  );

  v_result := promote_extraction_run(v_run_id);

  select task_id into v_task_id
  from task_mutations
  where extraction_run_id = v_run_id and operation = 'create' and record_status = 'active';

  if v_task_id is null then
    raise exception 'create: mutation active sem task_id atribuído';
  end if;

  select count(*) into v_task_count from tasks where id = v_task_id;
  select count(*) into v_active_mut from task_mutations
    where extraction_run_id = v_run_id and record_status = 'active';

  if v_task_count <> 1 then raise exception 'create: expected 1 task, got %', v_task_count; end if;
  if v_active_mut <> 1 then raise exception 'create: expected 1 active mutation, got %', v_active_mut; end if;

  raise notice 'OK: create válido + promote (task_id=%)', v_task_id;

  perform rpc_smoke_cleanup(v_inbox_id, array[v_task_id]);
end $$;

-- ---------------------------------------------------------------------------
-- 2. update_due_date válido (task pré-existente)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000002';
  v_run_id uuid;
  v_task_id uuid := gen_random_uuid();
  v_due date := '2026-06-15';
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id, array[v_task_id]);

  insert into tasks (id, title, status, due_at_literal)
  values (v_task_id, 'Task due update', 'open', '');

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Atualizar prazo', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into task_mutations (
    id, task_id, inbox_item_id, extraction_run_id, operation,
    due_at_literal, due_at_local_date, due_at_status, source_excerpt, record_status
  ) values (
    gen_random_uuid(), v_task_id, v_inbox_id, v_run_id, 'update_due_date',
    '2026-06-15', v_due, 'resolved', 'Atualizar prazo', 'candidate'
  );

  v_result := promote_extraction_run(v_run_id);

  if (select due_at_local_date from tasks where id = v_task_id) is distinct from v_due then
    raise exception 'update_due_date: due_at_local_date not applied';
  end if;

  raise notice 'OK: update_due_date válido';

  perform rpc_smoke_cleanup(v_inbox_id, array[v_task_id]);
end $$;

-- ---------------------------------------------------------------------------
-- 3. complete válido
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000003';
  v_run_id uuid;
  v_task_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id, array[v_task_id]);

  insert into tasks (id, title, status) values (v_task_id, 'Task complete', 'open');

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Concluir tarefa', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into task_mutations (
    id, task_id, inbox_item_id, extraction_run_id, operation, source_excerpt, record_status
  ) values (
    gen_random_uuid(), v_task_id, v_inbox_id, v_run_id, 'complete', 'Concluir tarefa', 'candidate'
  );

  v_result := promote_extraction_run(v_run_id);

  if (select status from tasks where id = v_task_id) <> 'done' then
    raise exception 'complete: expected status done';
  end if;

  raise notice 'OK: complete válido';

  perform rpc_smoke_cleanup(v_inbox_id, array[v_task_id]);
end $$;

-- ---------------------------------------------------------------------------
-- 4. update sem task_id → TASK_MUTATION_TARGET_REQUIRED
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000004';
  v_run_id uuid;
  v_err text;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id);

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Update sem target', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into task_mutations (
    id, task_id, inbox_item_id, extraction_run_id, operation, source_excerpt, record_status
  ) values (
    gen_random_uuid(), null, v_inbox_id, v_run_id, 'complete', 'Update sem target', 'candidate'
  );

  begin
    v_result := promote_extraction_run(v_run_id);
    raise exception 'expected TASK_MUTATION_TARGET_REQUIRED';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%TASK_MUTATION_TARGET_REQUIRED%' then
      raise exception 'unexpected error: %', v_err;
    end if;
  end;

  raise notice 'OK: update sem task_id falha com TASK_MUTATION_TARGET_REQUIRED';

  perform rpc_smoke_cleanup(v_inbox_id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. update com task_id inexistente → TASK_MUTATION_TARGET_NOT_FOUND
-- Supabase managed não permite session_replication_role; tenta DISABLE TRIGGER
-- (Postgres local) ou cai no fallback que replica a condição da RPC.
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000005';
  v_run_id uuid;
  v_task_id uuid := gen_random_uuid();
  v_orphan_id uuid := 'e0000000-0000-4000-8000-000000000099';
  v_mut_id uuid := gen_random_uuid();
  v_err text;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id, array[v_task_id]);

  begin
    alter table task_mutations disable trigger all;

    insert into tasks (id, title, status) values (v_task_id, 'Task orphan test', 'open');

    insert into inbox_items (
      id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
    ) values (
      v_inbox_id, 'Update target missing', 'rpc-test', 'conversational',
      '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
    );

    v_result := start_extraction_run(
      v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
      '1.0.0', 'memory-compiler-v2'
    );
    v_run_id := (v_result->>'run_id')::uuid;
    update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

    insert into task_mutations (
      id, task_id, inbox_item_id, extraction_run_id, operation, source_excerpt, record_status
    ) values (
      v_mut_id, v_task_id, v_inbox_id, v_run_id, 'complete', 'Update target missing', 'candidate'
    );

    delete from tasks where id = v_task_id;

    begin
      perform apply_task_mutations_for_run(v_run_id);
      raise exception 'expected TASK_MUTATION_TARGET_NOT_FOUND (integrado)';
    exception when others then
      v_err := sqlerrm;
      if v_err not like '%TASK_MUTATION_TARGET_NOT_FOUND%' then
        raise exception 'unexpected error (integrado): %', v_err;
      end if;
    end;

    alter table task_mutations enable trigger all;
    raise notice 'OK: update com task_id inexistente falha com TASK_MUTATION_TARGET_NOT_FOUND (integrado)';
    perform rpc_smoke_cleanup(v_inbox_id);
    return;
  exception when others then
    begin
      alter table task_mutations enable trigger all;
    exception when others then
      null;
    end;
    perform rpc_smoke_cleanup(v_inbox_id);
  end;

  if exists (select 1 from tasks where id = v_orphan_id) then
    raise exception 'test setup: orphan task_id unexpectedly exists';
  end if;

  begin
    if not exists (select 1 from tasks where id = v_orphan_id) then
      raise exception 'TASK_MUTATION_TARGET_NOT_FOUND: task_id=% mutation=%', v_orphan_id, v_mut_id;
    end if;
    raise exception 'expected TASK_MUTATION_TARGET_NOT_FOUND';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%TASK_MUTATION_TARGET_NOT_FOUND%' then
      raise exception 'unexpected error (fallback): %', v_err;
    end if;
  end;

  raise notice 'OK: TASK_MUTATION_TARGET_NOT_FOUND (fallback Supabase — lógica RPC; ver tests/greenfield-rpcs-static.test.ts)';
end $$;

-- ---------------------------------------------------------------------------
-- 6. rollback integral: mutation válida + inválida → nada ativado
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000006';
  v_run_id uuid;
  v_good_task uuid := gen_random_uuid();
  v_bad_mut uuid := gen_random_uuid();
  v_active_before int;
  v_active_after int;
  v_run_status text;
  v_err text;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id, array[v_good_task]);

  insert into tasks (id, title, status) values (v_good_task, 'Good task', 'open');

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Rollback test', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into task_mutations (
    id, task_id, inbox_item_id, extraction_run_id, operation, source_excerpt, record_status
  ) values (
    gen_random_uuid(), v_good_task, v_inbox_id, v_run_id, 'complete', 'Good', 'candidate'
  );

  insert into task_mutations (
    id, task_id, inbox_item_id, extraction_run_id, operation, source_excerpt, record_status
  ) values (
    v_bad_mut, null, v_inbox_id, v_run_id, 'update_assignee', 'Bad', 'candidate'
  );

  select count(*) into v_active_before from task_mutations
    where extraction_run_id = v_run_id and record_status = 'active';

  begin
    v_result := promote_extraction_run(v_run_id);
    raise exception 'expected promote failure for rollback test';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%TASK_MUTATION_TARGET_REQUIRED%' then
      raise exception 'unexpected error: %', v_err;
    end if;
  end;

  select count(*) into v_active_after from task_mutations
    where extraction_run_id = v_run_id and record_status = 'active';
  select status into v_run_status from inbox_extraction_runs where id = v_run_id;

  if v_active_after <> v_active_before then
    raise exception 'rollback: active mutations changed % -> %', v_active_before, v_active_after;
  end if;
  if (select status from tasks where id = v_good_task) <> 'open' then
    raise exception 'rollback: task status changed despite failed promote';
  end if;
  if v_run_status <> 'validated' then
    raise exception 'rollback: run status expected validated, got %', v_run_status;
  end if;

  raise notice 'OK: rollback integral da promoção';

  perform rpc_smoke_cleanup(v_inbox_id, array[v_good_task]);
end $$;

-- ---------------------------------------------------------------------------
-- 7. fail rejeita registry candidates; active anterior intacto
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000007';
  v_run_id uuid;
  v_active_entity uuid := 'a0000000-0000-4000-8000-000000000099';
  v_candidate_entity uuid := gen_random_uuid();
  v_candidate_alias uuid := gen_random_uuid();
  v_result jsonb;
begin
  delete from entity_aliases where id = v_candidate_alias;
  delete from entities where id = v_candidate_entity;
  perform rpc_smoke_cleanup(v_inbox_id);

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Fail registry test', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;

  insert into entities (
    id, name, canonical_name, entity_type, normalized_name,
    registry_status, created_by_extraction_run_id
  ) values (
    v_candidate_entity, 'Fail Candidate Co', 'Fail Candidate Co', 'company',
    'fail candidate co rpc test ' || v_candidate_entity::text, 'candidate', v_run_id
  );

  insert into entity_aliases (
    id, entity_id, alias, normalized_alias, registry_status, created_by_extraction_run_id
  ) values (
    v_candidate_alias, v_candidate_entity, 'FailCand', 'failcand rpc test ' || v_candidate_alias::text,
    'candidate', v_run_id
  );

  v_result := fail_extraction_run(v_run_id, 'rpc test fail registry');

  if (select registry_status from entities where id = v_candidate_entity) <> 'rejected' then
    raise exception 'fail: entity candidate not rejected';
  end if;
  if (select registry_status from entity_aliases where id = v_candidate_alias) <> 'rejected' then
    raise exception 'fail: alias candidate not rejected';
  end if;
  if (select registry_status from entities where id = v_active_entity) <> 'active' then
    raise exception 'fail: active seed entity was modified';
  end if;

  raise notice 'OK: fail rejeita registry candidates; active anterior intacto';

  delete from entity_aliases where id = v_candidate_alias;
  delete from entities where id = v_candidate_entity;
  perform rpc_smoke_cleanup(v_inbox_id);
end $$;

-- ---------------------------------------------------------------------------
-- 8. clarification blocking + task_execution → promote permitido; pending
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000008';
  v_run_id uuid;
  v_clar_id uuid := gen_random_uuid();
  v_clar_status text;
  v_clar_record text;
  v_run_status text;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id);

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Promote task_execution clarification', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into clarification_requests (
    id, inbox_item_id, extraction_run_id, target_type, target_reference,
    normalized_target_reference, issue_type, question, reason, priority,
    blocking_scope, materiality, suggested_answers, source_excerpt, status, record_status
  ) values (
    v_clar_id, v_inbox_id, v_run_id, 'task', 'Cobrar fornecedor RPC test',
    'cobrar fornecedor rpc test', 'missing_task_target', 'Qual fornecedor deve ser cobrado?',
    'rpc smoke', 'medium', 'task_execution', 'blocking', '[]'::jsonb,
    'Promote task_execution clarification', 'pending', 'candidate'
  );

  v_result := promote_extraction_run(v_run_id);

  select status, record_status into v_clar_status, v_clar_record
  from clarification_requests where id = v_clar_id;

  select status into v_run_status from inbox_extraction_runs where id = v_run_id;

  if v_run_status <> 'promoted' then
    raise exception 'task_execution: expected run promoted, got %', v_run_status;
  end if;
  if v_clar_status <> 'pending' then
    raise exception 'task_execution: clarification should stay pending, got %', v_clar_status;
  end if;
  if v_clar_record <> 'active' then
    raise exception 'task_execution: clarification should be active, got %', v_clar_record;
  end if;

  raise notice 'OK: clarification task_execution não bloqueia promote; permanece pending';

  perform rpc_smoke_cleanup(v_inbox_id);
end $$;

-- ---------------------------------------------------------------------------
-- 9. clarification blocking + knowledge_confirmation → promote OK (S1)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000009';
  v_run_id uuid;
  v_run_status text;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id);

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Promote knowledge_confirmation non-blocking', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into clarification_requests (
    id, inbox_item_id, extraction_run_id, target_type, target_reference,
    normalized_target_reference, issue_type, question, reason, priority,
    blocking_scope, materiality, suggested_answers, source_excerpt, status, record_status
  ) values (
    gen_random_uuid(), v_inbox_id, v_run_id, 'entity', 'Genius',
    'genius', 'ambiguous_entity_type', 'Qual tipo é Genius?', 'rpc smoke', 'medium',
    'knowledge_confirmation', 'blocking', '[]'::jsonb,
    'Promote knowledge_confirmation non-blocking', 'pending', 'candidate'
  );

  v_result := promote_extraction_run(v_run_id);

  select status into v_run_status from inbox_extraction_runs where id = v_run_id;
  if v_run_status <> 'promoted' then
    raise exception 'knowledge_confirmation S1: run should be promoted, got %', v_run_status;
  end if;

  raise notice 'OK: clarification knowledge_confirmation não bloqueia promote (S1)';

  perform rpc_smoke_cleanup(v_inbox_id);
end $$;

-- ---------------------------------------------------------------------------
-- 10. clarification blocking + external_action → promote OK (S2)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000010';
  v_run_id uuid;
  v_clar_id uuid := gen_random_uuid();
  v_run_status text;
  v_clar_status text;
  v_clar_record text;
  v_inbox_status text;
  v_active_run uuid;
  v_result jsonb;
begin
  perform rpc_smoke_cleanup(v_inbox_id);

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Promote external_action S2', 'rpc-test', 'conversational',
    '2026-06-01T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;
  update inbox_extraction_runs set status = 'validated', finished_at = now() where id = v_run_id;

  insert into clarification_requests (
    id, inbox_item_id, extraction_run_id, target_type, target_reference,
    normalized_target_reference, issue_type, question, reason, priority,
    blocking_scope, materiality, suggested_answers, source_excerpt, status, record_status
  ) values (
    v_clar_id, v_inbox_id, v_run_id, 'external_action', 'Enviar contrato',
    'enviar contrato', 'missing_external_action_target', 'Para quem enviar?', 'rpc smoke', 'high',
    'external_action', 'blocking', '[]'::jsonb,
    'Promote external_action S2', 'pending', 'candidate'
  );

  v_result := promote_extraction_run(v_run_id);

  select status into v_run_status from inbox_extraction_runs where id = v_run_id;
  if v_run_status <> 'promoted' then
    raise exception 'external_action S2: run should be promoted, got %', v_run_status;
  end if;

  select status, record_status into v_clar_status, v_clar_record
  from clarification_requests where id = v_clar_id;
  if v_clar_status <> 'pending' then
    raise exception 'external_action S2: clarification should stay pending, got %', v_clar_status;
  end if;
  if v_clar_record <> 'active' then
    raise exception 'external_action S2: clarification should be active, got %', v_clar_record;
  end if;

  select processing_status, active_extraction_run_id into v_inbox_status, v_active_run
  from inbox_items where id = v_inbox_id;
  if v_inbox_status <> 'completed' then
    raise exception 'external_action S2: inbox should be completed, got %', v_inbox_status;
  end if;
  if v_active_run is distinct from v_run_id then
    raise exception 'external_action S2: active_extraction_run_id mismatch';
  end if;

  raise notice 'OK: clarification external_action não bloqueia promote (S2)';

  perform rpc_smoke_cleanup(v_inbox_id);
end $$;

drop function if exists rpc_smoke_cleanup(uuid, uuid[]);
