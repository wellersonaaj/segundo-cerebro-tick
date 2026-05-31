-- Segundo Cérebro — align partially created databases with 001 + 002
-- Migration 004 (idempotent: safe to re-run; no DROP; preserves data)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- inbox_items
-- ---------------------------------------------------------------------------
create table if not exists inbox_items (
  id uuid primary key default gen_random_uuid()
);

alter table inbox_items add column if not exists raw_content text;
alter table inbox_items add column if not exists source_channel text;
alter table inbox_items add column if not exists source_mode text;
alter table inbox_items add column if not exists received_at timestamptz;
alter table inbox_items add column if not exists timezone text;
alter table inbox_items add column if not exists processing_status text;
alter table inbox_items add column if not exists extractor_version text;
alter table inbox_items add column if not exists processing_error text;
alter table inbox_items add column if not exists created_at timestamptz;
alter table inbox_items add column if not exists updated_at timestamptz;

update inbox_items set source_channel = 'manual' where source_channel is null;
update inbox_items set source_mode = 'conversational' where source_mode is null;
update inbox_items set received_at = coalesce(created_at, now()) where received_at is null;
update inbox_items set timezone = 'UTC' where timezone is null;
update inbox_items set processing_status = 'pending' where processing_status is null;
update inbox_items set created_at = now() where created_at is null;
update inbox_items set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;
update inbox_items set raw_content = coalesce(raw_content, '') where raw_content is null;

alter table inbox_items alter column raw_content set not null;
alter table inbox_items alter column source_channel set not null;
alter table inbox_items alter column source_mode set not null;
alter table inbox_items alter column received_at set not null;
alter table inbox_items alter column timezone set not null;
alter table inbox_items alter column processing_status set not null;
alter table inbox_items alter column created_at set not null;
alter table inbox_items alter column updated_at set not null;

alter table inbox_items alter column timezone set default 'UTC';
alter table inbox_items alter column processing_status set default 'pending';

create index if not exists idx_inbox_items_processing_status on inbox_items (processing_status);
create index if not exists idx_inbox_items_received_at on inbox_items (received_at desc);

-- ---------------------------------------------------------------------------
-- entities
-- ---------------------------------------------------------------------------
create table if not exists entities (
  id uuid primary key default gen_random_uuid()
);

alter table entities add column if not exists name text;
alter table entities add column if not exists entity_type text;
alter table entities add column if not exists normalized_name text;
alter table entities add column if not exists status text;
alter table entities add column if not exists superseded_by uuid;
alter table entities add column if not exists created_at timestamptz;
alter table entities add column if not exists updated_at timestamptz;

update entities set status = 'active' where status is null;
update entities set created_at = now() where created_at is null;
update entities set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;
update entities set name = coalesce(name, normalized_name, 'unknown') where name is null;
update entities set normalized_name = lower(trim(name)) where normalized_name is null and name is not null;
update entities set entity_type = 'other' where entity_type is null;

alter table entities alter column name set not null;
alter table entities alter column entity_type set not null;
alter table entities alter column normalized_name set not null;
alter table entities alter column status set not null;
alter table entities alter column created_at set not null;
alter table entities alter column updated_at set not null;
alter table entities alter column status set default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entities_superseded_by_fkey'
  ) then
    alter table entities
      add constraint entities_superseded_by_fkey
      foreign key (superseded_by) references entities (id);
  end if;
end $$;

create unique index if not exists idx_entities_normalized_name_active
  on entities (normalized_name)
  where status = 'active';

create index if not exists idx_entities_entity_type on entities (entity_type);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid()
);

alter table events add column if not exists inbox_item_id uuid;
alter table events add column if not exists event_type text;
alter table events add column if not exists description text;
alter table events add column if not exists occurred_at timestamptz;
alter table events add column if not exists source_excerpt text;
alter table events add column if not exists confidence numeric(4, 3);
alter table events add column if not exists status text;
alter table events add column if not exists superseded_by uuid;
alter table events add column if not exists correction_id uuid;
alter table events add column if not exists created_at timestamptz;

update events set status = 'active' where status is null;
update events set created_at = now() where created_at is null;
update events set source_excerpt = coalesce(source_excerpt, description, '') where source_excerpt is null;
update events set description = coalesce(description, '') where description is null;
update events set event_type = coalesce(event_type, 'other') where event_type is null;

alter table events alter column event_type set not null;
alter table events alter column description set not null;
alter table events alter column source_excerpt set not null;
alter table events alter column status set not null;
alter table events alter column created_at set not null;
alter table events alter column status set default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_inbox_item_id_fkey'
  ) then
    alter table events
      add constraint events_inbox_item_id_fkey
      foreign key (inbox_item_id) references inbox_items (id) on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_superseded_by_fkey'
  ) then
    alter table events
      add constraint events_superseded_by_fkey
      foreign key (superseded_by) references events (id);
  end if;
end $$;

create index if not exists idx_events_inbox_item_id on events (inbox_item_id);
create index if not exists idx_events_occurred_at on events (occurred_at desc nulls last);
create index if not exists idx_events_event_type on events (event_type);
create index if not exists idx_events_status on events (status);

-- ---------------------------------------------------------------------------
-- event_entities
-- ---------------------------------------------------------------------------
create table if not exists event_entities (
  id uuid primary key default gen_random_uuid()
);

alter table event_entities add column if not exists event_id uuid;
alter table event_entities add column if not exists entity_id uuid;
alter table event_entities add column if not exists role text;
alter table event_entities add column if not exists created_at timestamptz;

update event_entities set created_at = now() where created_at is null;

alter table event_entities alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_entities_event_id_fkey'
  ) then
    alter table event_entities
      add constraint event_entities_event_id_fkey
      foreign key (event_id) references events (id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_entities_entity_id_fkey'
  ) then
    alter table event_entities
      add constraint event_entities_entity_id_fkey
      foreign key (entity_id) references entities (id) on delete restrict;
  end if;
end $$;

create unique index if not exists idx_event_entities_event_entity
  on event_entities (event_id, entity_id);

create index if not exists idx_event_entities_entity_id on event_entities (entity_id);

-- ---------------------------------------------------------------------------
-- assertions
-- ---------------------------------------------------------------------------
create table if not exists assertions (
  id uuid primary key default gen_random_uuid()
);

alter table assertions add column if not exists inbox_item_id uuid;
alter table assertions add column if not exists assertion_type text;
alter table assertions add column if not exists content text;
alter table assertions add column if not exists status text;
alter table assertions add column if not exists source_excerpt text;
alter table assertions add column if not exists confidence numeric(4, 3);
alter table assertions add column if not exists record_status text;
alter table assertions add column if not exists superseded_by uuid;
alter table assertions add column if not exists correction_id uuid;
alter table assertions add column if not exists created_at timestamptz;

update assertions set status = 'unverified' where status is null;
update assertions set record_status = 'active' where record_status is null;
update assertions set created_at = now() where created_at is null;
update assertions set source_excerpt = coalesce(source_excerpt, content, '') where source_excerpt is null;
update assertions set content = coalesce(content, '') where content is null;
update assertions set assertion_type = coalesce(assertion_type, 'fact') where assertion_type is null;

alter table assertions alter column assertion_type set not null;
alter table assertions alter column content set not null;
alter table assertions alter column status set not null;
alter table assertions alter column source_excerpt set not null;
alter table assertions alter column record_status set not null;
alter table assertions alter column created_at set not null;
alter table assertions alter column status set default 'unverified';
alter table assertions alter column record_status set default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assertions_inbox_item_id_fkey'
  ) then
    alter table assertions
      add constraint assertions_inbox_item_id_fkey
      foreign key (inbox_item_id) references inbox_items (id) on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assertions_superseded_by_fkey'
  ) then
    alter table assertions
      add constraint assertions_superseded_by_fkey
      foreign key (superseded_by) references assertions (id);
  end if;
end $$;

create index if not exists idx_assertions_inbox_item_id on assertions (inbox_item_id);
create index if not exists idx_assertions_status on assertions (status);
create index if not exists idx_assertions_record_status on assertions (record_status);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid()
);

alter table tasks add column if not exists inbox_item_id uuid;
alter table tasks add column if not exists title text;
alter table tasks add column if not exists description text;
alter table tasks add column if not exists due_at timestamptz;
alter table tasks add column if not exists temporal_reference_text text;
alter table tasks add column if not exists source_excerpt text;
alter table tasks add column if not exists is_commitment boolean;
alter table tasks add column if not exists status text;
alter table tasks add column if not exists confidence numeric(4, 3);
alter table tasks add column if not exists superseded_by uuid;
alter table tasks add column if not exists correction_id uuid;
alter table tasks add column if not exists created_at timestamptz;
alter table tasks add column if not exists updated_at timestamptz;

update tasks set is_commitment = false where is_commitment is null;
update tasks set status = 'open' where status is null;
update tasks set created_at = now() where created_at is null;
update tasks set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;
update tasks set source_excerpt = coalesce(source_excerpt, title, '') where source_excerpt is null;
update tasks set title = coalesce(title, '') where title is null;

alter table tasks alter column title set not null;
alter table tasks alter column source_excerpt set not null;
alter table tasks alter column is_commitment set not null;
alter table tasks alter column status set not null;
alter table tasks alter column created_at set not null;
alter table tasks alter column updated_at set not null;
alter table tasks alter column is_commitment set default false;
alter table tasks alter column status set default 'open';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_inbox_item_id_fkey'
  ) then
    alter table tasks
      add constraint tasks_inbox_item_id_fkey
      foreign key (inbox_item_id) references inbox_items (id) on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_superseded_by_fkey'
  ) then
    alter table tasks
      add constraint tasks_superseded_by_fkey
      foreign key (superseded_by) references tasks (id);
  end if;
end $$;

create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_due_at on tasks (due_at nulls last);

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------
create table if not exists policies (
  id uuid primary key default gen_random_uuid()
);

alter table policies add column if not exists code text;
alter table policies add column if not exists name text;
alter table policies add column if not exists description text;
alter table policies add column if not exists category text;
alter table policies add column if not exists operation text;
alter table policies add column if not exists scope_type text;
alter table policies add column if not exists scope_id text;
alter table policies add column if not exists enforcement_stage text;
alter table policies add column if not exists enforcement_mode text;
alter table policies add column if not exists content text;
alter table policies add column if not exists priority integer;
alter table policies add column if not exists status text;
alter table policies add column if not exists metadata jsonb;
alter table policies add column if not exists created_at timestamptz;
alter table policies add column if not exists updated_at timestamptz;

update policies set operation = 'all' where operation is null;
update policies set scope_type = 'global' where scope_type is null;
update policies set enforcement_stage = 'before_generation' where enforcement_stage is null;
update policies set enforcement_mode = 'prompt_instruction' where enforcement_mode is null;
update policies set priority = 100 where priority is null;
update policies set status = 'active' where status is null;
update policies set metadata = '{}'::jsonb where metadata is null;
update policies set created_at = now() where created_at is null;
update policies set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

create index if not exists idx_policies_status on policies (status);
create index if not exists idx_policies_operation on policies (operation);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where tablename = 'policies'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(code)%'
  ) then
    create unique index idx_policies_code on policies (code);
  end if;
end $$;

insert into policies (code, name, description, category, operation, enforcement_mode, content, priority)
values
  (
    'PRESERVE_ORIGINAL_INPUT',
    'Preserve original input',
    'Never overwrite captured raw content.',
    'memory',
    'all',
    'hard_block',
    'Never overwrite or alter the original captured content in inbox_items.',
    10
  ),
  (
    'DISTINGUISH_FACT_FROM_HYPOTHESIS',
    'Distinguish fact from hypothesis',
    'Separate facts, hypotheses, opinions, decisions and commitments.',
    'reasoning',
    'register_event',
    'prompt_instruction',
    'Do not treat hypotheses as confirmed facts.',
    20
  ),
  (
    'EXTERNAL_ACTION_REQUIRES_APPROVAL',
    'External actions require approval',
    'External actions need explicit human approval in MVP.',
    'execution',
    'all',
    'hard_block',
    'Do not execute external actions without approval.',
    5
  )
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- entity_aliases (002)
-- ---------------------------------------------------------------------------
create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid()
);

alter table entity_aliases add column if not exists entity_id uuid;
alter table entity_aliases add column if not exists alias text;
alter table entity_aliases add column if not exists normalized_alias text;
alter table entity_aliases add column if not exists created_at timestamptz;

update entity_aliases set created_at = now() where created_at is null;

alter table entity_aliases alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entity_aliases_entity_id_fkey'
  ) then
    alter table entity_aliases
      add constraint entity_aliases_entity_id_fkey
      foreign key (entity_id) references entities (id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where tablename = 'entity_aliases'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(normalized_alias)%'
  ) then
    create unique index idx_entity_aliases_normalized_alias on entity_aliases (normalized_alias);
  end if;
end $$;

create index if not exists idx_entity_aliases_entity_id on entity_aliases (entity_id);

-- ---------------------------------------------------------------------------
-- entity_resolution_logs (002)
-- ---------------------------------------------------------------------------
create table if not exists entity_resolution_logs (
  id uuid primary key default gen_random_uuid()
);

alter table entity_resolution_logs add column if not exists inbox_item_id uuid;
alter table entity_resolution_logs add column if not exists extracted_entity_name text;
alter table entity_resolution_logs add column if not exists resolution_status text;
alter table entity_resolution_logs add column if not exists resolved_entity_id uuid;
alter table entity_resolution_logs add column if not exists resolution_method text;
alter table entity_resolution_logs add column if not exists confidence numeric(4, 3);
alter table entity_resolution_logs add column if not exists evidence jsonb;
alter table entity_resolution_logs add column if not exists created_at timestamptz;

update entity_resolution_logs set evidence = '{}'::jsonb where evidence is null;
update entity_resolution_logs set created_at = now() where created_at is null;
update entity_resolution_logs set extracted_entity_name = coalesce(extracted_entity_name, '') where extracted_entity_name is null;
update entity_resolution_logs set resolution_status = coalesce(resolution_status, 'unresolved') where resolution_status is null;

alter table entity_resolution_logs alter column extracted_entity_name set not null;
alter table entity_resolution_logs alter column resolution_status set not null;
alter table entity_resolution_logs alter column evidence set not null;
alter table entity_resolution_logs alter column created_at set not null;
alter table entity_resolution_logs alter column evidence set default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entity_resolution_logs_inbox_item_id_fkey'
  ) then
    alter table entity_resolution_logs
      add constraint entity_resolution_logs_inbox_item_id_fkey
      foreign key (inbox_item_id) references inbox_items (id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entity_resolution_logs_resolved_entity_id_fkey'
  ) then
    alter table entity_resolution_logs
      add constraint entity_resolution_logs_resolved_entity_id_fkey
      foreign key (resolved_entity_id) references entities (id);
  end if;
end $$;

create index if not exists idx_entity_resolution_logs_inbox_item_id
  on entity_resolution_logs (inbox_item_id);

-- ---------------------------------------------------------------------------
-- clarification_requests (002)
-- ---------------------------------------------------------------------------
create table if not exists clarification_requests (
  id uuid primary key default gen_random_uuid()
);

alter table clarification_requests add column if not exists inbox_item_id uuid;
alter table clarification_requests add column if not exists target_type text;
alter table clarification_requests add column if not exists target_reference text;
alter table clarification_requests add column if not exists issue_type text;
alter table clarification_requests add column if not exists question text;
alter table clarification_requests add column if not exists reason text;
alter table clarification_requests add column if not exists priority text;
alter table clarification_requests add column if not exists blocking_scope text;
alter table clarification_requests add column if not exists suggested_answers jsonb;
alter table clarification_requests add column if not exists source_excerpt text;
alter table clarification_requests add column if not exists status text;
alter table clarification_requests add column if not exists answer text;
alter table clarification_requests add column if not exists answered_at timestamptz;
alter table clarification_requests add column if not exists created_at timestamptz;
alter table clarification_requests add column if not exists updated_at timestamptz;

update clarification_requests set suggested_answers = '[]'::jsonb where suggested_answers is null;
update clarification_requests set status = 'pending' where status is null;
update clarification_requests set created_at = now() where created_at is null;
update clarification_requests set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;
update clarification_requests set blocking_scope = coalesce(blocking_scope, 'none') where blocking_scope is null;
update clarification_requests set priority = coalesce(priority, 'medium') where priority is null;
update clarification_requests set source_excerpt = coalesce(source_excerpt, question, '') where source_excerpt is null;
update clarification_requests set question = coalesce(question, '') where question is null;
update clarification_requests set reason = coalesce(reason, '') where reason is null;
update clarification_requests set target_reference = coalesce(target_reference, '') where target_reference is null;
update clarification_requests set target_type = coalesce(target_type, 'other') where target_type is null;
update clarification_requests set issue_type = coalesce(issue_type, 'other') where issue_type is null;

alter table clarification_requests alter column target_type set not null;
alter table clarification_requests alter column target_reference set not null;
alter table clarification_requests alter column issue_type set not null;
alter table clarification_requests alter column question set not null;
alter table clarification_requests alter column reason set not null;
alter table clarification_requests alter column priority set not null;
alter table clarification_requests alter column blocking_scope set not null;
alter table clarification_requests alter column suggested_answers set not null;
alter table clarification_requests alter column source_excerpt set not null;
alter table clarification_requests alter column status set not null;
alter table clarification_requests alter column created_at set not null;
alter table clarification_requests alter column updated_at set not null;
alter table clarification_requests alter column suggested_answers set default '[]'::jsonb;
alter table clarification_requests alter column status set default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clarification_requests_inbox_item_id_fkey'
  ) then
    alter table clarification_requests
      add constraint clarification_requests_inbox_item_id_fkey
      foreign key (inbox_item_id) references inbox_items (id) on delete cascade;
  end if;
end $$;

create index if not exists idx_clarification_requests_status on clarification_requests (status);
create index if not exists idx_clarification_requests_inbox_item_id
  on clarification_requests (inbox_item_id);

-- ---------------------------------------------------------------------------
-- corrections (002)
-- ---------------------------------------------------------------------------
create table if not exists corrections (
  id uuid primary key default gen_random_uuid()
);

alter table corrections add column if not exists inbox_item_id uuid;
alter table corrections add column if not exists correction_text text;
alter table corrections add column if not exists created_at timestamptz;

update corrections set created_at = now() where created_at is null;
update corrections set correction_text = coalesce(correction_text, '') where correction_text is null;

alter table corrections alter column correction_text set not null;
alter table corrections alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'corrections_inbox_item_id_fkey'
  ) then
    alter table corrections
      add constraint corrections_inbox_item_id_fkey
      foreign key (inbox_item_id) references inbox_items (id) on delete restrict;
  end if;
end $$;

create index if not exists idx_corrections_inbox_item_id on corrections (inbox_item_id);

-- FK from events/assertions/tasks to corrections (002)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_events_correction'
  ) then
    alter table events
      add constraint fk_events_correction
      foreign key (correction_id) references corrections (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_assertions_correction'
  ) then
    alter table assertions
      add constraint fk_assertions_correction
      foreign key (correction_id) references corrections (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_tasks_correction'
  ) then
    alter table tasks
      add constraint fk_tasks_correction
      foreign key (correction_id) references corrections (id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS (preserve / enable if missing)
-- ---------------------------------------------------------------------------
alter table inbox_items enable row level security;
alter table entities enable row level security;
alter table events enable row level security;
alter table event_entities enable row level security;
alter table assertions enable row level security;
alter table tasks enable row level security;
alter table policies enable row level security;
alter table entity_aliases enable row level security;
alter table entity_resolution_logs enable row level security;
alter table clarification_requests enable row level security;
alter table corrections enable row level security;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
