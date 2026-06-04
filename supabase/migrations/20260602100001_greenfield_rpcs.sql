-- Segundo Cérebro — greenfield RPCs (Bloco 6B)
-- start / promote / fail extraction runs + task mutation projection

-- ---------------------------------------------------------------------------
-- Helper: map status_signal → tasks.status
-- ---------------------------------------------------------------------------
create or replace function public.map_task_status_signal(p_signal text)
returns text
language sql
immutable
as $$
  select case p_signal
    when 'completed' then 'done'
    when 'cancelled' then 'cancelled'
    when 'blocked' then 'blocked'
    when 'open' then 'open'
    else 'open'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: apply candidate task_mutations to tasks projection
-- ---------------------------------------------------------------------------
create or replace function public.apply_task_mutations_for_run(p_run_id uuid)
returns void
language plpgsql
as $$
declare
  v_mut record;
  v_task_id uuid;
  v_status text;
begin
  for v_mut in
    select *
    from task_mutations
    where extraction_run_id = p_run_id
      and record_status = 'candidate'
    order by created_at, id
  loop
    if v_mut.operation = 'create' then
      v_task_id := coalesce(v_mut.task_id, gen_random_uuid());

      insert into tasks (
        id, title, task_kind, status,
        assignee_entity_id, project_entity_id, blocked_reason,
        source_excerpt, confidence,
        due_at_literal, due_at_local_date, due_at_local_time, due_at_instant,
        due_at_timezone, due_at_timezone_source, due_at_precision, due_at_status,
        due_at_reason_code, due_at_normalizer_id, due_at_normalizer_version,
        due_at_implicit_year, due_at_implicit_month, due_at_evidence
      ) values (
        v_task_id,
        coalesce(v_mut.title, 'Untitled'),
        v_mut.task_kind,
        public.map_task_status_signal(coalesce(v_mut.status_signal, 'open')),
        v_mut.assignee_entity_id,
        v_mut.project_entity_id,
        v_mut.blocked_reason,
        v_mut.source_excerpt,
        v_mut.confidence,
        coalesce(v_mut.due_at_literal, ''),
        v_mut.due_at_local_date,
        v_mut.due_at_local_time,
        v_mut.due_at_instant,
        coalesce(v_mut.due_at_timezone, 'America/Sao_Paulo'),
        v_mut.due_at_timezone_source,
        v_mut.due_at_precision,
        v_mut.due_at_status,
        v_mut.due_at_reason_code,
        v_mut.due_at_normalizer_id,
        v_mut.due_at_normalizer_version,
        v_mut.due_at_implicit_year,
        v_mut.due_at_implicit_month,
        v_mut.due_at_evidence
      )
      on conflict (id) do update set
        title = excluded.title,
        task_kind = excluded.task_kind,
        status = excluded.status,
        assignee_entity_id = excluded.assignee_entity_id,
        project_entity_id = excluded.project_entity_id,
        blocked_reason = excluded.blocked_reason,
        source_excerpt = excluded.source_excerpt,
        confidence = excluded.confidence,
        due_at_literal = excluded.due_at_literal,
        due_at_local_date = excluded.due_at_local_date,
        due_at_local_time = excluded.due_at_local_time,
        due_at_instant = excluded.due_at_instant,
        due_at_timezone = excluded.due_at_timezone,
        due_at_timezone_source = excluded.due_at_timezone_source,
        due_at_precision = excluded.due_at_precision,
        due_at_status = excluded.due_at_status,
        due_at_reason_code = excluded.due_at_reason_code,
        due_at_normalizer_id = excluded.due_at_normalizer_id,
        due_at_normalizer_version = excluded.due_at_normalizer_version,
        due_at_implicit_year = excluded.due_at_implicit_year,
        due_at_implicit_month = excluded.due_at_implicit_month,
        due_at_evidence = excluded.due_at_evidence,
        updated_at = now();

      update task_mutations
        set task_id = v_task_id
        where id = v_mut.id and task_id is null;

    else
      if v_mut.task_id is null then
        raise exception 'TASK_MUTATION_TARGET_REQUIRED: mutation=% operation=%',
          v_mut.id, v_mut.operation;
      end if;

      if not exists (select 1 from tasks where id = v_mut.task_id) then
        raise exception 'TASK_MUTATION_TARGET_NOT_FOUND: task_id=% mutation=%',
          v_mut.task_id, v_mut.id;
      end if;

      v_task_id := v_mut.task_id;
      v_status := public.map_task_status_signal(coalesce(v_mut.status_signal, 'open'));

      if v_mut.operation = 'update_status' then
        update tasks set status = v_status, updated_at = now() where id = v_task_id;
      elsif v_mut.operation = 'update_due_date' then
        update tasks set
          due_at_literal = coalesce(v_mut.due_at_literal, ''),
          due_at_local_date = v_mut.due_at_local_date,
          due_at_local_time = v_mut.due_at_local_time,
          due_at_instant = v_mut.due_at_instant,
          due_at_timezone = coalesce(v_mut.due_at_timezone, 'America/Sao_Paulo'),
          due_at_timezone_source = v_mut.due_at_timezone_source,
          due_at_precision = v_mut.due_at_precision,
          due_at_status = v_mut.due_at_status,
          due_at_reason_code = v_mut.due_at_reason_code,
          due_at_normalizer_id = v_mut.due_at_normalizer_id,
          due_at_normalizer_version = v_mut.due_at_normalizer_version,
          due_at_implicit_year = v_mut.due_at_implicit_year,
          due_at_implicit_month = v_mut.due_at_implicit_month,
          due_at_evidence = v_mut.due_at_evidence,
          updated_at = now()
        where id = v_task_id;
      elsif v_mut.operation = 'update_assignee' then
        update tasks set assignee_entity_id = v_mut.assignee_entity_id, updated_at = now()
        where id = v_task_id;
      elsif v_mut.operation = 'update_blocker' then
        update tasks set
          status = 'blocked',
          blocked_reason = v_mut.blocked_reason,
          updated_at = now()
        where id = v_task_id;
      elsif v_mut.operation = 'complete' then
        update tasks set status = 'done', updated_at = now() where id = v_task_id;
      elsif v_mut.operation = 'cancel' then
        update tasks set status = 'cancelled', updated_at = now() where id = v_task_id;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_extraction_run
-- ---------------------------------------------------------------------------
create or replace function start_extraction_run(
  p_inbox_item_id uuid,
  p_trigger_type text,
  p_schema_version text,
  p_prompt_version text,
  p_extractor_version text,
  p_model_name text,
  p_normalizer_version text,
  p_compiler_version text,
  p_correction_id uuid default null,
  p_input_content_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_in_progress uuid;
begin
  if p_trigger_type is null or p_trigger_type not in ('initial', 'correction', 'reprocess') then
    raise exception 'INVALID_TRIGGER_TYPE: %', coalesce(p_trigger_type, 'null');
  end if;

  if p_schema_version is null or p_prompt_version is null
     or p_extractor_version is null or p_model_name is null
     or p_normalizer_version is null or p_compiler_version is null then
    raise exception 'MISSING_VERSION_PARAMS';
  end if;

  perform 1 from inbox_items where id = p_inbox_item_id for update;
  if not found then
    raise exception 'INBOX_NOT_FOUND: %', p_inbox_item_id;
  end if;

  select id into v_in_progress
  from inbox_extraction_runs
  where inbox_item_id = p_inbox_item_id
    and status in ('started', 'validated')
  order by created_at desc
  limit 1;

  if v_in_progress is not null then
    raise exception 'RUN_ALREADY_IN_PROGRESS: %', v_in_progress;
  end if;

  insert into inbox_extraction_runs (
    inbox_item_id, trigger_type, correction_id, status,
    schema_version, prompt_version, extractor_version, model_name,
    normalizer_version, compiler_version,
    input_content_hash, started_at
  ) values (
    p_inbox_item_id, p_trigger_type, p_correction_id, 'started',
    p_schema_version, p_prompt_version, p_extractor_version, p_model_name,
    p_normalizer_version, p_compiler_version,
    p_input_content_hash, now()
  ) returning id into v_run_id;

  update inbox_items set
    latest_extraction_run_id = v_run_id,
    processing_status = 'processing',
    processing_error = null
  where id = p_inbox_item_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'inbox_item_id', p_inbox_item_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- promote_extraction_run
-- ---------------------------------------------------------------------------
create or replace function promote_extraction_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbox_id uuid;
  v_run_status text;
  v_extractor_version text;
  v_latest_run_id uuid;
  v_blocking_count int;
begin
  select inbox_item_id, status, extractor_version
    into v_inbox_id, v_run_status, v_extractor_version
    from inbox_extraction_runs where id = p_run_id;

  if v_inbox_id is null then
    raise exception 'RUN_NOT_FOUND: %', p_run_id;
  end if;

  select latest_extraction_run_id into v_latest_run_id
    from inbox_items where id = v_inbox_id for update;

  if v_latest_run_id is distinct from p_run_id then
    update inbox_extraction_runs
      set status = 'discarded',
          finished_at = now(),
          error_message = 'RUN_STALE: superseded by newer extraction run'
      where id = p_run_id and status = 'validated';

    raise exception 'RUN_STALE: latest=% expected=%', v_latest_run_id, p_run_id;
  end if;

  select status into v_run_status from inbox_extraction_runs
    where id = p_run_id for update;

  if v_run_status is distinct from 'validated' then
    raise exception 'RUN_NOT_READY: status=%', v_run_status;
  end if;

  select count(*) into v_blocking_count
  from clarification_requests
  where extraction_run_id = p_run_id
    and record_status = 'candidate'
    and materiality = 'blocking'
    and status = 'pending'
    and blocking_scope in ('knowledge_confirmation', 'external_action')
    and priority <> 'low';

  if v_blocking_count > 0 then
    raise exception 'BLOCKING_CLARIFICATIONS: % pending material blocking clarifications', v_blocking_count;
  end if;

  -- Supersede prior active artifacts for this inbox
  update inbox_item_entities set record_status = 'superseded', updated_at = now()
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update events set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update assertions set record_status = 'superseded', is_current = false
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update task_mutations set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update clarification_requests set record_status = 'superseded', updated_at = now()
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update entity_alias_evidences set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  -- Apply task mutations before activating
  perform public.apply_task_mutations_for_run(p_run_id);

  -- Activate candidates from this run
  update inbox_item_entities set record_status = 'active', updated_at = now()
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update events set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update assertions set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update task_mutations set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update clarification_requests set record_status = 'active', updated_at = now()
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update entity_alias_evidences set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  -- status_update: supersede prior is_current for same subject+predicate
  update assertions a set is_current = false
  from assertions incoming
  where incoming.extraction_run_id = p_run_id
    and incoming.record_status = 'active'
    and incoming.assertion_kind = 'status_update'
    and incoming.subject_entity_id is not null
    and a.subject_entity_id = incoming.subject_entity_id
    and a.predicate = incoming.predicate
    and a.assertion_kind = 'status_update'
    and a.record_status = 'active'
    and a.is_current = true
    and a.id <> incoming.id;

  update assertions set is_current = true
  where extraction_run_id = p_run_id
    and record_status = 'active'
    and assertion_kind = 'status_update'
    and subject_entity_id is not null;

  update entities set registry_status = 'active'
    where registry_status = 'candidate'
      and id in (
        select distinct entity_id from inbox_item_entities
        where extraction_run_id = p_run_id and record_status = 'active'
      );

  update entity_aliases set registry_status = 'active'
    where registry_status = 'candidate'
      and id in (
        select distinct entity_alias_id from entity_alias_evidences
        where extraction_run_id = p_run_id and record_status = 'active'
      );

  update inbox_extraction_runs
    set status = 'promoted', promoted_at = now(),
        finished_at = coalesce(finished_at, now())
    where id = p_run_id;

  update inbox_items set
    active_extraction_run_id = p_run_id,
    latest_extraction_run_id = p_run_id,
    processing_status = 'completed',
    processed_at = now(),
    processing_error = null,
    extractor_version = v_extractor_version
  where id = v_inbox_id;

  return jsonb_build_object(
    'inbox_item_id', v_inbox_id,
    'run_id', p_run_id,
    'has_active_memory', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- fail_extraction_run
-- ---------------------------------------------------------------------------
create or replace function fail_extraction_run(p_run_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbox_id uuid;
  v_active_run_id uuid;
  v_latest_run_id uuid;
  v_stale boolean := false;
begin
  select r.inbox_item_id, i.active_extraction_run_id, i.latest_extraction_run_id
    into v_inbox_id, v_active_run_id, v_latest_run_id
    from inbox_extraction_runs r
    join inbox_items i on i.id = r.inbox_item_id
    where r.id = p_run_id
    for update of i;

  if v_inbox_id is null then
    raise exception 'RUN_NOT_FOUND: %', p_run_id;
  end if;

  update inbox_extraction_runs
    set status = 'failed', finished_at = now(), error_message = p_error
    where id = p_run_id;

  update inbox_item_entities set record_status = 'rejected', updated_at = now()
    where extraction_run_id = p_run_id and record_status = 'candidate';
  update events set record_status = 'rejected'
    where extraction_run_id = p_run_id and record_status = 'candidate';
  update assertions set record_status = 'rejected'
    where extraction_run_id = p_run_id and record_status = 'candidate';
  update task_mutations set record_status = 'rejected'
    where extraction_run_id = p_run_id and record_status = 'candidate';
  update clarification_requests set record_status = 'rejected', updated_at = now()
    where extraction_run_id = p_run_id and record_status = 'candidate';
  update entity_alias_evidences set record_status = 'rejected'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update entities set registry_status = 'rejected', updated_at = now()
    where created_by_extraction_run_id = p_run_id
      and registry_status = 'candidate';

  update entity_aliases set registry_status = 'rejected'
    where created_by_extraction_run_id = p_run_id
      and registry_status = 'candidate';

  if v_latest_run_id is distinct from p_run_id then
    v_stale := true;
  else
    update inbox_items set
      latest_extraction_run_id = p_run_id,
      processing_status = 'failed',
      processing_error = p_error
    where id = v_inbox_id;
  end if;

  return jsonb_build_object(
    'inbox_item_id', v_inbox_id,
    'run_id', p_run_id,
    'processing_status', case when v_stale then null else 'failed' end,
    'has_active_memory', (v_active_run_id is not null),
    'stale_run', v_stale
  );
end;
$$;

revoke all on function start_extraction_run(
  uuid, text, text, text, text, text, text, text, uuid, text
) from public;
grant execute on function start_extraction_run(
  uuid, text, text, text, text, text, text, text, uuid, text
) to service_role;

revoke all on function promote_extraction_run(uuid) from public;
grant execute on function promote_extraction_run(uuid) to service_role;

revoke all on function fail_extraction_run(uuid, text) from public;
grant execute on function fail_extraction_run(uuid, text) to service_role;

notify pgrst, 'reload schema';
