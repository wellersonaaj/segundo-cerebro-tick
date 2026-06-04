-- persist_extraction_candidates
-- Single RPC that writes all candidate artifacts in one atomic transaction.
-- Replaces the multi-call app-side loop in PersistenceV2Service.persistCandidates.

create or replace function persist_extraction_candidates(
  p_inbox_item_id uuid,
  p_extraction_run_id uuid,
  p_correction_id uuid default null,
  p_entities jsonb default '[]'::jsonb,
  p_inbox_item_entities jsonb default '[]'::jsonb,
  p_aliases jsonb default '[]'::jsonb,
  p_events jsonb default '[]'::jsonb,
  p_assertions jsonb default '[]'::jsonb,
  p_task_mutations jsonb default '[]'::jsonb,
  p_clarifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_ids jsonb;
  v_entity record;
  v_ent record;
  v_ie record;
  v_alia record;
  v_alias_id uuid;
  v_ev record;
  v_event_id uuid;
  v_link record;
  v_asr record;
  v_assertion_id uuid;
  v_a_link record;
  v_tm record;
  v_task_mutation_id uuid;
  v_cl record;
  v_cl_id uuid;
  v_result jsonb;
begin
  -- 1. Upsert entities
  for v_entity in select * from jsonb_to_recordset(p_entities) as x(
    name text, entity_type text, normalized_name text
  )
  loop
    insert into entities (name, canonical_name, entity_type, normalized_name, registry_status, created_by_extraction_run_id)
    values (v_entity.name, v_entity.name, v_entity.entity_type, v_entity.normalized_name, 'candidate', p_extraction_run_id)
    on conflict (normalized_name) where registry_status in ('active', 'candidate')
    do update set updated_at = now();
  end loop;

  -- Build entity_id lookup map for every entity name referenced in the payload (incl. registry active)
  select jsonb_object_agg(e.normalized_name, e.id)
  into v_entity_ids
  from entities e
  where e.registry_status in ('active', 'candidate')
    and e.normalized_name in (
      select distinct norm from (
        select (elem ->> 'normalized_name') as norm
        from jsonb_array_elements(p_entities) elem
        where (elem ->> 'normalized_name') is not null
        union
        select normalize_text(x.entity_name)
        from jsonb_to_recordset(p_inbox_item_entities) as x(
          entity_name text, relation_type text, source_excerpt text, source_block_ref text, confidence numeric
        )
        where x.entity_name is not null
        union
        select normalize_text(x.target_entity_name)
        from jsonb_to_recordset(p_aliases) as x(
          target_entity_name text, alias text, source_excerpt text, source_block_ref text, confidence numeric
        )
        where x.target_entity_name is not null
        union
        select normalize_text(link.entity_name)
        from jsonb_to_recordset(p_events) as ev(
          event_kind text, title text, occurred_at text, episodic_confidence numeric,
          source_excerpt text, source_block_ref text, confidence numeric, related_entities jsonb
        )
        cross join lateral jsonb_to_recordset(ev.related_entities) as link(
          entity_name text, relation_type text, role text, resolution_status text
        )
        where link.entity_name is not null
        union
        select normalize_text(x.subject_entity_name)
        from jsonb_to_recordset(p_assertions) as x(
          assertion_kind text, subject_ref text, subject_entity_name text, predicate text,
          object_ref text, value_text text, source_excerpt text, source_block_ref text,
          confidence numeric, related_entity_refs jsonb
        )
        where x.subject_entity_name is not null
        union
        select normalize_text(ref.value)
        from jsonb_to_recordset(p_assertions) as x(
          assertion_kind text, subject_ref text, subject_entity_name text, predicate text,
          object_ref text, value_text text, source_excerpt text, source_block_ref text,
          confidence numeric, related_entity_refs jsonb
        )
        cross join lateral jsonb_array_elements_text(coalesce(x.related_entity_refs, '[]'::jsonb)) ref(value)
        union
        select normalize_text(x.assignee_entity_name)
        from jsonb_to_recordset(p_task_mutations) as x(
          operation text, task_ref text, title text, task_kind text, status_signal text,
          assignee_entity_name text, project_entity_name text, blocked_reason text,
          source_excerpt text, source_block_ref text, confidence numeric, task_id uuid,
          context_resolution_evidence jsonb, due_at_literal text, due_at_local_date text,
          due_at_local_time text, due_at_instant text, due_at_timezone text, due_at_precision text,
          due_at_status text, due_at_reason_code text, due_at_normalizer_version text,
          due_at_implicit_year boolean, due_at_implicit_month boolean
        )
        where x.assignee_entity_name is not null
        union
        select normalize_text(x.project_entity_name)
        from jsonb_to_recordset(p_task_mutations) as x(
          operation text, task_ref text, title text, task_kind text, status_signal text,
          assignee_entity_name text, project_entity_name text, blocked_reason text,
          source_excerpt text, source_block_ref text, confidence numeric, task_id uuid,
          context_resolution_evidence jsonb, due_at_literal text, due_at_local_date text,
          due_at_local_time text, due_at_instant text, due_at_timezone text, due_at_precision text,
          due_at_status text, due_at_reason_code text, due_at_normalizer_version text,
          due_at_implicit_year boolean, due_at_implicit_month boolean
        )
        where x.project_entity_name is not null
      ) names
      where norm is not null and norm <> ''
    );

  if v_entity_ids is null then
    v_entity_ids := '{}'::jsonb;
  end if;

  -- 2. Insert inbox_item_entities
  for v_ie in select * from jsonb_to_recordset(p_inbox_item_entities) as x(
    entity_name text, relation_type text, source_excerpt text, source_block_ref text, confidence numeric
  )
  loop
    if (v_entity_ids ->> normalize_text(v_ie.entity_name)) is null then
      continue;
    end if;

    insert into inbox_item_entities (
      inbox_item_id, extraction_run_id, entity_id, relation_type,
      source_excerpt, source_block_reference, confidence,
      correction_id, record_status
    ) values (
      p_inbox_item_id, p_extraction_run_id,
      ((v_entity_ids ->> normalize_text(v_ie.entity_name))::uuid),
      coalesce(v_ie.relation_type, 'mentioned'),
      v_ie.source_excerpt, v_ie.source_block_ref, v_ie.confidence,
      p_correction_id, 'candidate'
    ) on conflict (extraction_run_id, entity_id, relation_type) do nothing;
  end loop;

  -- 3. Insert aliases + alias evidences
  for v_alia in select * from jsonb_to_recordset(p_aliases) as x(
    target_entity_name text, alias text, source_excerpt text,
    source_block_ref text, confidence numeric
  )
  loop
    if (v_entity_ids ->> normalize_text(v_alia.target_entity_name)) is null then
      continue;
    end if;

    insert into entity_aliases (
      entity_id, alias, normalized_alias, registry_status, created_by_extraction_run_id
    ) values (
      ((v_entity_ids ->> normalize_text(v_alia.target_entity_name))::uuid),
      v_alia.alias, normalize_text(v_alia.alias), 'candidate', p_extraction_run_id
    )
    on conflict (normalized_alias) where registry_status in ('active', 'candidate')
    do nothing;

    -- Global uniqueness (idx_entity_aliases_normalized_active_candidate): owner may differ from target entity.
    select id into v_alias_id
    from entity_aliases
    where normalized_alias = normalize_text(v_alia.alias)
      and registry_status in ('active', 'candidate');

    if v_alias_id is not null then
      insert into entity_alias_evidences (
        entity_alias_id, inbox_item_id, extraction_run_id,
        source_excerpt, source_block_reference, confidence, record_status
      ) values (
        v_alias_id, p_inbox_item_id, p_extraction_run_id,
        v_alia.source_excerpt, v_alia.source_block_ref, v_alia.confidence, 'candidate'
      ) on conflict (entity_alias_id, extraction_run_id, source_excerpt) do nothing;
    end if;
  end loop;

  -- 4. Insert events + event_entities
  for v_ev in select * from jsonb_to_recordset(p_events) as x(
    event_kind text, title text, occurred_at text, episodic_confidence numeric,
    source_excerpt text, source_block_ref text, confidence numeric,
    related_entities jsonb
  )
  loop
    insert into events (
      inbox_item_id, extraction_run_id, event_kind, title, occurred_at,
      episodic_confidence, source_excerpt, source_block_reference,
      confidence, correction_id, record_status
    ) values (
      p_inbox_item_id, p_extraction_run_id, v_ev.event_kind, v_ev.title,
      case
        when v_ev.occurred_at is not null
         and v_ev.occurred_at != ''
         and v_ev.occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then v_ev.occurred_at::timestamptz
        else null
      end,
      v_ev.episodic_confidence, v_ev.source_excerpt, v_ev.source_block_ref,
      v_ev.confidence, p_correction_id, 'candidate'
    )
    returning id into v_event_id;

    for v_link in select * from jsonb_to_recordset(v_ev.related_entities) as x(
      entity_name text, relation_type text, role text, resolution_status text
    )
    loop
      insert into event_entities (
        event_id, entity_id, entity_reference, relation_type, role, resolution_status
      ) values (
        v_event_id,
        ((v_entity_ids ->> normalize_text(v_link.entity_name))::uuid),
        v_link.entity_name, v_link.relation_type, v_link.role,
        coalesce(v_link.resolution_status, 'unresolved')
      ) on conflict on constraint uq_event_entities_event_relation_ref do nothing;
    end loop;
  end loop;

  -- 5. Insert assertions + assertion_entities
  for v_asr in select * from jsonb_to_recordset(p_assertions) as x(
    assertion_kind text, subject_ref text, subject_entity_name text,
    predicate text, object_ref text, value_text text,
    source_excerpt text, source_block_ref text, confidence numeric,
    related_entity_refs jsonb
  )
  loop
    insert into assertions (
      inbox_item_id, extraction_run_id, assertion_kind, subject_reference,
      subject_entity_id, predicate, object_reference, value_text,
      source_excerpt, source_block_reference, confidence,
      is_current, correction_id, record_status
    ) values (
      p_inbox_item_id, p_extraction_run_id, v_asr.assertion_kind,
      v_asr.subject_ref,
      case when v_asr.subject_entity_name is not null
           then ((v_entity_ids ->> normalize_text(v_asr.subject_entity_name))::uuid)
           else null end,
      v_asr.predicate, v_asr.object_ref, v_asr.value_text,
      v_asr.source_excerpt, v_asr.source_block_ref, v_asr.confidence,
      v_asr.assertion_kind = 'status_update'
        and v_asr.subject_entity_name is not null
        and (v_entity_ids ? normalize_text(v_asr.subject_entity_name)),
      p_correction_id, 'candidate'
    )
    returning id into v_assertion_id;

    -- Subject entity link
    if v_asr.subject_entity_name is not null
       and v_entity_ids ? normalize_text(v_asr.subject_entity_name)
    then
      insert into assertion_entities (
        assertion_id, entity_id, entity_reference, reference_role, resolution_status
      ) values (
        v_assertion_id,
        ((v_entity_ids ->> normalize_text(v_asr.subject_entity_name))::uuid),
        v_asr.subject_ref, 'subject', 'resolved'
      ) on conflict do nothing;
    end if;

    -- Related entity links
    for v_a_link in select value::text as ref
      from jsonb_array_elements_text(coalesce(v_asr.related_entity_refs, '[]'::jsonb))
    loop
      insert into assertion_entities (
        assertion_id, entity_id, entity_reference, reference_role, resolution_status
      ) values (
        v_assertion_id,
        case when v_entity_ids ? normalize_text(v_a_link.ref)
             then ((v_entity_ids ->> normalize_text(v_a_link.ref))::uuid)
             else null end,
        v_a_link.ref, 'related',
        case when v_entity_ids ? normalize_text(v_a_link.ref)
             then 'resolved' else 'unresolved' end
      ) on conflict do nothing;
    end loop;
  end loop;

  -- 6. Insert task_mutations
  for v_tm in select * from jsonb_to_recordset(p_task_mutations) as x(
    operation text, task_ref text, title text, task_kind text,
    status_signal text, assignee_entity_name text, project_entity_name text,
    blocked_reason text, source_excerpt text, source_block_ref text,
    confidence numeric, task_id uuid, context_resolution_evidence jsonb,
    due_at_literal text, due_at_local_date text, due_at_local_time text,
    due_at_instant text, due_at_timezone text, due_at_precision text,
    due_at_status text, due_at_reason_code text, due_at_normalizer_version text,
    due_at_implicit_year boolean, due_at_implicit_month boolean
  )
  loop
    insert into task_mutations (
      task_id, inbox_item_id, extraction_run_id, operation,
      task_reference, title, task_kind, status_signal,
      assignee_entity_id, project_entity_id, blocked_reason,
      source_excerpt, source_block_reference, confidence,
      context_resolution_evidence,
      due_at_literal, due_at_local_date, due_at_local_time,
      due_at_instant, due_at_timezone, due_at_precision,
      due_at_status, due_at_reason_code, due_at_normalizer_version,
      due_at_implicit_year, due_at_implicit_month,
      record_status, correction_id
    ) values (
      case when v_tm.operation = 'create' then null else v_tm.task_id end,
      p_inbox_item_id, p_extraction_run_id, v_tm.operation,
      v_tm.task_ref, v_tm.title, v_tm.task_kind, v_tm.status_signal,
      case when v_tm.assignee_entity_name is not null
           then ((v_entity_ids ->> normalize_text(v_tm.assignee_entity_name))::uuid)
           else null end,
      case when v_tm.project_entity_name is not null
           then ((v_entity_ids ->> normalize_text(v_tm.project_entity_name))::uuid)
           else null end,
      v_tm.blocked_reason,
      v_tm.source_excerpt, v_tm.source_block_ref, v_tm.confidence,
      v_tm.context_resolution_evidence,
      coalesce(v_tm.due_at_literal, ''),
      case when v_tm.due_at_local_date is not null and v_tm.due_at_local_date != ''
           then v_tm.due_at_local_date::date else null end,
      case when v_tm.due_at_local_time is not null and v_tm.due_at_local_time != ''
           then v_tm.due_at_local_time::time else null end,
      case when v_tm.due_at_instant is not null and v_tm.due_at_instant != ''
           then v_tm.due_at_instant::timestamptz else null end,
      coalesce(v_tm.due_at_timezone, 'America/Sao_Paulo'),
      v_tm.due_at_precision, v_tm.due_at_status, v_tm.due_at_reason_code,
      v_tm.due_at_normalizer_version,
      v_tm.due_at_implicit_year, v_tm.due_at_implicit_month,
      'candidate', p_correction_id
    )
    on conflict (extraction_run_id, operation,
      coalesce(task_reference, ''), coalesce(title, ''))
    where record_status = 'candidate'
    do nothing
    returning id into v_task_mutation_id;
  end loop;

  -- 7. Insert clarifications
  for v_cl in select * from jsonb_to_recordset(p_clarifications) as x(
    target_type text, target_reference text, issue_type text,
    question text, reason text, priority text, blocking_scope text,
    materiality text, suggested_answers jsonb, source_excerpt text,
    source text
  )
  loop
    insert into clarification_requests (
      inbox_item_id, extraction_run_id, target_type, target_reference,
      normalized_target_reference, issue_type, question, reason,
      priority, blocking_scope, materiality, suggested_answers,
      source_excerpt, source_block_reference,
      status, record_status, correction_id
    ) values (
      p_inbox_item_id, p_extraction_run_id,
      v_cl.target_type, v_cl.target_reference,
      normalize_text(coalesce(v_cl.target_reference, '')),
      v_cl.issue_type, v_cl.question, v_cl.reason,
      v_cl.priority, v_cl.blocking_scope, v_cl.materiality,
      v_cl.suggested_answers,
      v_cl.source_excerpt, null,
      'pending', 'candidate', p_correction_id
    )
    returning id into v_cl_id;
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'inbox_item_id', p_inbox_item_id,
    'extraction_run_id', p_extraction_run_id
  );

  return v_result;
end;
$$;

revoke all on function persist_extraction_candidates(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function persist_extraction_candidates(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
