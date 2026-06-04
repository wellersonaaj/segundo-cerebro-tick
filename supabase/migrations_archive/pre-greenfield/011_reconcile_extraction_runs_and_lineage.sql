-- 011: Reconcile inbox_extraction_runs (may exist in Supabase) + lineage columns

create table if not exists inbox_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  status text not null default 'started',
  schema_version text,
  prompt_version text,
  model_name text,
  raw_model_output text,
  parsed_output jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

alter table inbox_extraction_runs add column if not exists correction_id uuid references corrections (id);
alter table inbox_extraction_runs add column if not exists trigger_type text;
alter table inbox_extraction_runs add column if not exists extractor_version text;
alter table inbox_extraction_runs add column if not exists input_content_hash text;
alter table inbox_extraction_runs add column if not exists validation_errors jsonb;
alter table inbox_extraction_runs add column if not exists promoted_at timestamptz;

alter table inbox_items add column if not exists active_extraction_run_id uuid references inbox_extraction_runs (id);
alter table inbox_items add column if not exists latest_extraction_run_id uuid references inbox_extraction_runs (id);

create index if not exists idx_inbox_extraction_runs_inbox_item_id
  on inbox_extraction_runs (inbox_item_id, created_at desc);
create index if not exists idx_inbox_extraction_runs_status on inbox_extraction_runs (status);

create table if not exists inbox_item_entities (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  entity_id uuid not null references entities (id) on delete restrict,
  relation_type text not null default 'mentioned',
  source_excerpt text not null default '',
  confidence numeric(4, 3),
  record_status text not null default 'candidate',
  correction_id uuid references corrections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extraction_run_id, entity_id, relation_type)
);

create index if not exists idx_inbox_item_entities_inbox_active
  on inbox_item_entities (inbox_item_id)
  where record_status = 'active';
create index if not exists idx_inbox_item_entities_entity_active
  on inbox_item_entities (entity_id)
  where record_status = 'active';

alter table events add column if not exists extraction_run_id uuid references inbox_extraction_runs (id);
alter table events add column if not exists record_status text not null default 'active';

alter table assertions add column if not exists extraction_run_id uuid references inbox_extraction_runs (id);

alter table tasks add column if not exists extraction_run_id uuid references inbox_extraction_runs (id);
alter table tasks add column if not exists record_status text not null default 'active';

alter table clarification_requests add column if not exists extraction_run_id uuid references inbox_extraction_runs (id);
alter table clarification_requests add column if not exists record_status text not null default 'active';

alter table entity_resolution_logs add column if not exists extraction_run_id uuid references inbox_extraction_runs (id);

alter table assertions drop constraint if exists assertions_record_status_check;
alter table assertions add constraint assertions_record_status_check
  check (record_status in ('candidate', 'active', 'superseded'));

alter table events drop constraint if exists events_record_status_check;
alter table events add constraint events_record_status_check
  check (record_status in ('candidate', 'active', 'superseded'));

alter table tasks drop constraint if exists tasks_record_status_check;
alter table tasks add constraint tasks_record_status_check
  check (record_status in ('candidate', 'active', 'superseded'));

alter table clarification_requests drop constraint if exists clarification_requests_record_status_check;
alter table clarification_requests add constraint clarification_requests_record_status_check
  check (record_status in ('candidate', 'active', 'superseded'));

alter table inbox_item_entities drop constraint if exists inbox_item_entities_record_status_check;
alter table inbox_item_entities add constraint inbox_item_entities_record_status_check
  check (record_status in ('candidate', 'active', 'superseded'));

alter table inbox_item_entities drop constraint if exists inbox_item_entities_relation_type_check;
alter table inbox_item_entities add constraint inbox_item_entities_relation_type_check
  check (relation_type in ('mentioned', 'subject', 'author', 'recipient'));

alter table inbox_extraction_runs drop constraint if exists inbox_extraction_runs_trigger_type_check;
alter table inbox_extraction_runs add constraint inbox_extraction_runs_trigger_type_check
  check (trigger_type is null or trigger_type in ('initial', 'correction', 'reprocess'));

alter table inbox_extraction_runs drop constraint if exists inbox_extraction_runs_status_check;
alter table inbox_extraction_runs add constraint inbox_extraction_runs_status_check
  check (status in ('started', 'validated', 'promoted', 'failed', 'discarded'));

alter table inbox_item_entities enable row level security;
alter table inbox_extraction_runs enable row level security;

notify pgrst, 'reload schema';
