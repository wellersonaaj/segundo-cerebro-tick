-- 013: Extraction run RPCs (start / promote / fail) with single-flight and stale protection

create or replace function start_extraction_run(
  p_inbox_item_id uuid,
  p_trigger_type text,
  p_schema_version text,
  p_prompt_version text,
  p_extractor_version text,
  p_model_name text,
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
     or p_extractor_version is null or p_model_name is null then
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
    input_content_hash, started_at
  ) values (
    p_inbox_item_id, p_trigger_type, p_correction_id, 'started',
    p_schema_version, p_prompt_version, p_extractor_version, p_model_name,
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

  update inbox_item_entities set record_status = 'superseded', updated_at = now()
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update events set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update assertions set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update tasks set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update clarification_requests set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update entity_alias_evidences set record_status = 'superseded'
    where inbox_item_id = v_inbox_id and record_status = 'active'
      and extraction_run_id is distinct from p_run_id;

  update inbox_item_entities set record_status = 'active', updated_at = now()
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update events set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update assertions set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update tasks set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update clarification_requests set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

  update entity_alias_evidences set record_status = 'active'
    where extraction_run_id = p_run_id and record_status = 'candidate';

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

revoke all on function start_extraction_run(uuid, text, text, text, text, text, uuid, text) from public;
grant execute on function start_extraction_run(uuid, text, text, text, text, text, uuid, text) to service_role;

revoke all on function promote_extraction_run(uuid) from public;
grant execute on function promote_extraction_run(uuid) to service_role;

revoke all on function fail_extraction_run(uuid, text) from public;
grant execute on function fail_extraction_run(uuid, text) to service_role;

notify pgrst, 'reload schema';
