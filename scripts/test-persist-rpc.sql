-- Smoke: persist_extraction_candidates idempotência de alias global (manual ou CI com DATABASE_URL)
-- psql "$DATABASE_URL" -f scripts/test-persist-rpc.sql

do $$
declare
  v_inbox_id uuid := 'f0000000-0000-4000-8000-000000000020';
  v_run_id uuid;
  v_genius_entity uuid;
  v_genius_norm text := 'genius hotels';
  v_result jsonb;
  v_alias_count int;
  v_evidence_count int;
begin
  select id into v_genius_entity from entities
  where normalized_name = v_genius_norm and registry_status = 'active'
  limit 1;

  if v_genius_entity is null then
    raise exception 'seed Genius Hotels ausente — rode greenfield seeds';
  end if;

  update inbox_items set
    active_extraction_run_id = null,
    latest_extraction_run_id = null
  where id = v_inbox_id;

  delete from entity_alias_evidences where inbox_item_id = v_inbox_id;
  delete from inbox_item_entities where inbox_item_id = v_inbox_id;
  delete from inbox_extraction_runs where inbox_item_id = v_inbox_id;
  delete from inbox_items where id = v_inbox_id;

  insert into inbox_items (
    id, raw_content, source_channel, source_mode, received_at, timezone, processing_status
  ) values (
    v_inbox_id, 'Persist alias smoke', 'rpc-test', 'conversational',
    '2026-06-04T10:00:00-03:00', 'America/Sao_Paulo', 'pending'
  );

  v_result := start_extraction_run(
    v_inbox_id, 'initial', '1.4', 'extractor-v1.4', 'extractor-v1.4', 'test-model',
    '1.0.0', 'memory-compiler-v2'
  );
  v_run_id := (v_result->>'run_id')::uuid;

  -- Alias "Genius" já pertence à entidade seed; RPC deve anexar evidência sem violar unique global.
  v_result := persist_extraction_candidates(
    v_inbox_id,
    v_run_id,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'target_entity_name', 'Genius Hotels',
        'alias', 'Genius',
        'source_excerpt', 'persist rpc smoke excerpt',
        'confidence', 0.9
      )
    ),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  );

  if coalesce(v_result->>'ok', '') <> 'true' then
    raise exception 'persist_extraction_candidates returned %', v_result;
  end if;

  select count(*) into v_alias_count
  from entity_aliases
  where normalized_alias = 'genius'
    and registry_status in ('active', 'candidate');

  select count(*) into v_evidence_count
  from entity_alias_evidences
  where extraction_run_id = v_run_id
    and source_excerpt = 'persist rpc smoke excerpt';

  if v_alias_count <> 1 then
    raise exception 'expected 1 global alias row for genius, got %', v_alias_count;
  end if;
  if v_evidence_count <> 1 then
    raise exception 'expected 1 alias evidence, got %', v_evidence_count;
  end if;

  -- Segunda chamada idempotente (mesmo alias + excerpt)
  v_result := persist_extraction_candidates(
    v_inbox_id,
    v_run_id,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'target_entity_name', 'Genius Hotels',
        'alias', 'Genius',
        'source_excerpt', 'persist rpc smoke excerpt',
        'confidence', 0.9
      )
    ),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  );

  select count(*) into v_evidence_count
  from entity_alias_evidences
  where extraction_run_id = v_run_id
    and source_excerpt = 'persist rpc smoke excerpt';

  if v_evidence_count <> 1 then
    raise exception 'idempotent persist: expected 1 evidence, got %', v_evidence_count;
  end if;

  update inbox_items set
    active_extraction_run_id = null,
    latest_extraction_run_id = null
  where id = v_inbox_id;

  delete from entity_alias_evidences where inbox_item_id = v_inbox_id;
  delete from inbox_extraction_runs where inbox_item_id = v_inbox_id;
  delete from inbox_items where id = v_inbox_id;

  raise notice 'OK: persist_extraction_candidates alias global + idempotent evidence';
end $$;
