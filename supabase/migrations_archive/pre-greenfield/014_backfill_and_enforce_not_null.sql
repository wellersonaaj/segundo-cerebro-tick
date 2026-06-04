-- 014: Backfill synthetic runs + enforce NOT NULL on extraction_run_id

do $$
declare
  v_inbox record;
  v_run_id uuid;
  v_has_artifacts boolean;
  v_inconsistent_count int;
begin
  -- Abort if active artifacts exist without inbox linkage we cannot backfill
  select count(*) into v_inconsistent_count
  from (
    select id from events where record_status = 'active' and extraction_run_id is null
    union all
    select id from assertions where record_status = 'active' and extraction_run_id is null
    union all
    select id from tasks where record_status = 'active' and extraction_run_id is null
    union all
    select id from clarification_requests where record_status = 'active' and extraction_run_id is null
  ) t;

  if v_inconsistent_count > 0 then
    raise exception 'BACKFILL_ABORT: % active artifacts without extraction_run_id on non-completed inboxes require manual review', v_inconsistent_count;
  end if;

  for v_inbox in
    select id, extractor_version, processed_at, processing_status, active_extraction_run_id
    from inbox_items
    where processing_status = 'completed'
  loop
    if v_inbox.active_extraction_run_id is not null then
      continue;
    end if;

    insert into inbox_extraction_runs (
      inbox_item_id,
      trigger_type,
      status,
      schema_version,
      prompt_version,
      extractor_version,
      model_name,
      started_at,
      finished_at,
      promoted_at,
      created_at
    ) values (
      v_inbox.id,
      'initial',
      'promoted',
      coalesce(v_inbox.extractor_version, 'extractor-v1.3'),
      coalesce(v_inbox.extractor_version, 'extractor-v1.3'),
      coalesce(v_inbox.extractor_version, 'extractor-v1.3'),
      'backfill',
      coalesce(v_inbox.processed_at, now()),
      coalesce(v_inbox.processed_at, now()),
      coalesce(v_inbox.processed_at, now()),
      coalesce(v_inbox.processed_at, now())
    ) returning id into v_run_id;

    update inbox_items set
      active_extraction_run_id = v_run_id,
      latest_extraction_run_id = v_run_id
    where id = v_inbox.id;

    update events set extraction_run_id = v_run_id
      where inbox_item_id = v_inbox.id and extraction_run_id is null;
    update events set record_status = case
      when status = 'superseded' then 'superseded'
      when status = 'invalidated' then 'superseded'
      else 'active'
    end where inbox_item_id = v_inbox.id and extraction_run_id = v_run_id;

    update assertions set extraction_run_id = v_run_id
      where inbox_item_id = v_inbox.id and extraction_run_id is null;
    update assertions set record_status = case
      when record_status = 'superseded' then 'superseded'
      else 'active'
    end where inbox_item_id = v_inbox.id and extraction_run_id = v_run_id;

    update tasks set extraction_run_id = v_run_id
      where inbox_item_id = v_inbox.id and extraction_run_id is null;
    update tasks set
      record_status = case when status = 'superseded' then 'superseded' else 'active' end,
      status = case when status = 'superseded' then 'cancelled' else status end
    where inbox_item_id = v_inbox.id and extraction_run_id = v_run_id;

    update clarification_requests set extraction_run_id = v_run_id
      where inbox_item_id = v_inbox.id and extraction_run_id is null;

    update entity_resolution_logs set extraction_run_id = v_run_id
      where inbox_item_id = v_inbox.id and extraction_run_id is null;
  end loop;

  -- Verify completed inboxes have active run
  select count(*) into v_inconsistent_count
  from inbox_items
  where processing_status = 'completed' and active_extraction_run_id is null;

  if v_inconsistent_count > 0 then
    raise exception 'BACKFILL_ABORT: % completed inbox_items without active_extraction_run_id', v_inconsistent_count;
  end if;
end $$;

-- Remove superseded from tasks operational status
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('open', 'done', 'cancelled'));

notify pgrst, 'reload schema';
