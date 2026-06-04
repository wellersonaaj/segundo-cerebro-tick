-- S1 / S1.1: promote global bloqueado apenas por external_action insegura.
-- knowledge_confirmation e task_execution não impedem promote (materiality persiste no CM).

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
    and blocking_scope in ('external_action')
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

  perform public.apply_task_mutations_for_run(p_run_id);

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
