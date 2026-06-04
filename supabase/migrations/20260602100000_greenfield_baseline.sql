-- Segundo Cérebro — greenfield baseline v2 (CompiledMemoryV2)
-- Bloco 6A — instalação limpa; não depende de migrations 001–014

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.normalize_text(input text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(
    translate(
      coalesce(input, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    ),
    '\s+', ' ', 'g'
  )));
$$;

-- ---------------------------------------------------------------------------
-- inbox_items (immutable source)
-- ---------------------------------------------------------------------------
create table if not exists inbox_items (
  id uuid primary key default gen_random_uuid(),
  raw_content text not null,
  source_channel text not null,
  source_mode text not null check (source_mode in ('conversational', 'passive')),
  source_reference text,
  received_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  metadata jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending' check (
    processing_status in ('pending', 'processing', 'completed', 'failed')
  ),
  extractor_version text,
  processing_error text,
  processed_at timestamptz,
  active_extraction_run_id uuid,
  latest_extraction_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inbox_items_processing_status on inbox_items (processing_status);
create index if not exists idx_inbox_items_received_at on inbox_items (received_at desc);
create index if not exists idx_inbox_items_source_channel on inbox_items (source_channel);
create unique index if not exists idx_inbox_items_source_reference
  on inbox_items (source_channel, source_reference)
  where source_reference is not null;

create or replace function public.inbox_items_prevent_raw_content_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.raw_content is distinct from old.raw_content then
    raise exception 'INBOX_RAW_CONTENT_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_inbox_items_immutable_raw on inbox_items;
create trigger trg_inbox_items_immutable_raw
  before update on inbox_items
  for each row execute function public.inbox_items_prevent_raw_content_update();

-- ---------------------------------------------------------------------------
-- corrections (append-only)
-- ---------------------------------------------------------------------------
create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  correction_text text not null,
  source_block_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_corrections_inbox_item_id on corrections (inbox_item_id);

-- ---------------------------------------------------------------------------
-- inbox_extraction_runs (versioned pipeline)
-- ---------------------------------------------------------------------------
create table if not exists inbox_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  correction_id uuid references corrections (id),
  trigger_type text check (trigger_type is null or trigger_type in ('initial', 'correction', 'reprocess')),
  status text not null default 'started' check (
    status in ('started', 'validated', 'promoted', 'failed', 'discarded')
  ),
  schema_version text not null,
  prompt_version text not null,
  extractor_version text not null,
  model_name text not null,
  normalizer_version text not null,
  compiler_version text not null,
  input_content_hash text,
  raw_model_output text,
  parsed_output jsonb,
  compiled_output jsonb,
  validation_errors jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbox_extraction_runs_inbox_item_id
  on inbox_extraction_runs (inbox_item_id, created_at desc);
create index if not exists idx_inbox_extraction_runs_status on inbox_extraction_runs (status);

alter table inbox_items
  add constraint fk_inbox_items_active_run
  foreign key (active_extraction_run_id) references inbox_extraction_runs (id);
alter table inbox_items
  add constraint fk_inbox_items_latest_run
  foreign key (latest_extraction_run_id) references inbox_extraction_runs (id);

-- ---------------------------------------------------------------------------
-- entities (registry global)
-- ---------------------------------------------------------------------------
create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  canonical_name text not null,
  entity_type text not null check (
    entity_type in (
      'person', 'company', 'project', 'product', 'topic', 'document', 'location', 'other'
    )
  ),
  normalized_name text not null,
  registry_status text not null default 'active' check (
    registry_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  superseded_by uuid references entities (id),
  created_by_extraction_run_id uuid references inbox_extraction_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_entities_normalized_name_active
  on entities (normalized_name)
  where registry_status = 'active';

create index if not exists idx_entities_entity_type on entities (entity_type);
create index if not exists idx_entities_registry_status on entities (registry_status, normalized_name);

-- ---------------------------------------------------------------------------
-- entity_aliases
-- ---------------------------------------------------------------------------
create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  registry_status text not null default 'active' check (
    registry_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  superseded_by uuid references entity_aliases (id),
  created_by_extraction_run_id uuid references inbox_extraction_runs (id),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_entity_aliases_normalized_active_candidate
  on entity_aliases (normalized_alias)
  where registry_status in ('active', 'candidate');

create index if not exists idx_entity_aliases_entity_id on entity_aliases (entity_id);

-- ---------------------------------------------------------------------------
-- entity_alias_evidences
-- ---------------------------------------------------------------------------
create table if not exists entity_alias_evidences (
  id uuid primary key default gen_random_uuid(),
  entity_alias_id uuid not null references entity_aliases (id) on delete cascade,
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  source_excerpt text not null default '',
  source_block_reference text,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  negated boolean not null default false,
  record_status text not null default 'candidate' check (
    record_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  created_at timestamptz not null default now(),
  unique (entity_alias_id, extraction_run_id, source_excerpt)
);

create index if not exists idx_entity_alias_evidences_run on entity_alias_evidences (extraction_run_id);

-- ---------------------------------------------------------------------------
-- inbox_item_entities
-- ---------------------------------------------------------------------------
create table if not exists inbox_item_entities (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  entity_id uuid not null references entities (id) on delete restrict,
  relation_type text not null default 'mentioned' check (
    relation_type in ('mentioned', 'subject', 'author', 'recipient')
  ),
  source_excerpt text not null default '',
  source_block_reference text,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  record_status text not null default 'candidate' check (
    record_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  correction_id uuid references corrections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extraction_run_id, entity_id, relation_type)
);

create index if not exists idx_inbox_item_entities_inbox_active
  on inbox_item_entities (inbox_item_id)
  where record_status = 'active';

-- ---------------------------------------------------------------------------
-- tasks (global projection)
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  task_kind text check (
    task_kind is null or task_kind in (
      'follow_up', 'delivery', 'decision', 'review', 'external_action', 'other'
    )
  ),
  status text not null default 'open' check (
    status in ('open', 'done', 'cancelled', 'blocked')
  ),
  assignee_entity_id uuid references entities (id),
  project_entity_id uuid references entities (id),
  blocked_reason text,
  source_excerpt text,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  due_at_literal text not null default '',
  due_at_local_date date,
  due_at_local_time time,
  due_at_instant timestamptz,
  due_at_timezone text not null default 'America/Sao_Paulo',
  due_at_timezone_source text check (due_at_timezone_source is null or due_at_timezone_source in ('envelope', 'default')),
  due_at_precision text check (
    due_at_precision is null or due_at_precision in ('date', 'datetime', 'time_only', 'unknown')
  ),
  due_at_status text check (
    due_at_status is null or due_at_status in ('resolved', 'ambiguous', 'not_applicable', 'failed')
  ),
  due_at_reason_code text,
  due_at_normalizer_id text,
  due_at_normalizer_version text,
  due_at_implicit_year boolean,
  due_at_implicit_month boolean,
  due_at_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_assignee on tasks (assignee_entity_id);
create index if not exists idx_tasks_project on tasks (project_entity_id);
create index if not exists idx_tasks_due_at_local_date
  on tasks (due_at_local_date nulls last)
  where due_at_status = 'resolved';

-- ---------------------------------------------------------------------------
-- task_mutations (immutable history)
-- ---------------------------------------------------------------------------
create table if not exists task_mutations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks (id),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  operation text not null check (
    operation in (
      'create', 'update_status', 'update_due_date', 'update_assignee',
      'update_blocker', 'complete', 'cancel'
    )
  ),
  task_reference text,
  title text,
  task_kind text,
  status_signal text check (
    status_signal is null or status_signal in ('open', 'completed', 'cancelled', 'blocked', 'unknown')
  ),
  assignee_entity_id uuid references entities (id),
  project_entity_id uuid references entities (id),
  blocked_reason text,
  source_excerpt text not null default '',
  source_block_reference text,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  context_resolution_evidence jsonb,
  due_at_literal text not null default '',
  due_at_local_date date,
  due_at_local_time time,
  due_at_instant timestamptz,
  due_at_timezone text not null default 'America/Sao_Paulo',
  due_at_timezone_source text check (due_at_timezone_source is null or due_at_timezone_source in ('envelope', 'default')),
  due_at_precision text check (
    due_at_precision is null or due_at_precision in ('date', 'datetime', 'time_only', 'unknown')
  ),
  due_at_status text check (
    due_at_status is null or due_at_status in ('resolved', 'ambiguous', 'not_applicable', 'failed')
  ),
  due_at_reason_code text,
  due_at_normalizer_id text,
  due_at_normalizer_version text,
  due_at_implicit_year boolean,
  due_at_implicit_month boolean,
  due_at_evidence jsonb,
  record_status text not null default 'candidate' check (
    record_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  correction_id uuid references corrections (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_task_mutations_run on task_mutations (extraction_run_id);
create index if not exists idx_task_mutations_task on task_mutations (task_id);
create unique index if not exists idx_task_mutations_dedup
  on task_mutations (
    extraction_run_id,
    operation,
    coalesce(task_reference, ''),
    coalesce(title, '')
  )
  where record_status = 'candidate';

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  event_kind text not null check (
    event_kind in (
      'meeting', 'confirmation', 'decision', 'document_sent', 'presentation',
      'commitment', 'change', 'correction', 'other'
    )
  ),
  title text not null,
  occurred_at timestamptz,
  episodic_confidence numeric(4, 3) check (episodic_confidence >= 0 and episodic_confidence <= 1),
  source_excerpt text not null,
  source_block_reference text,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  record_status text not null default 'candidate' check (
    record_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  superseded_by uuid references events (id),
  correction_id uuid references corrections (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_events_inbox_item_id on events (inbox_item_id);
create index if not exists idx_events_extraction_run_id on events (extraction_run_id);
create index if not exists idx_events_record_status on events (record_status);

-- ---------------------------------------------------------------------------
-- event_entities
-- ---------------------------------------------------------------------------
create table if not exists event_entities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  entity_id uuid references entities (id) on delete restrict,
  entity_reference text,
  relation_type text not null check (
    relation_type in ('participant', 'subject', 'mentioned', 'sender', 'recipient', 'other')
  ),
  role text,
  resolution_status text not null default 'unresolved' check (
    resolution_status in ('resolved', 'ambiguous', 'unresolved')
  ),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_event_entities_unique_link
  on event_entities (
    event_id,
    relation_type,
    coalesce(entity_id::text, ''),
    coalesce(entity_reference, '')
  );

create index if not exists idx_event_entities_entity_id on event_entities (entity_id);

-- ---------------------------------------------------------------------------
-- assertions
-- ---------------------------------------------------------------------------
create table if not exists assertions (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  assertion_kind text not null check (
    assertion_kind in (
      'fact', 'hypothesis', 'opinion', 'decision', 'commitment', 'status_update', 'other'
    )
  ),
  subject_reference text not null,
  subject_entity_id uuid references entities (id),
  predicate text not null,
  object_reference text,
  value_text text,
  verification_status text not null default 'unverified' check (
    verification_status in ('unverified', 'confirmed', 'invalidated')
  ),
  is_current boolean not null default false,
  source_excerpt text not null,
  source_block_reference text,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  record_status text not null default 'candidate' check (
    record_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  superseded_by uuid references assertions (id),
  correction_id uuid references corrections (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_assertions_inbox_item_id on assertions (inbox_item_id);
create index if not exists idx_assertions_extraction_run_id on assertions (extraction_run_id);
create unique index if not exists idx_assertions_status_update_current
  on assertions (subject_entity_id, predicate)
  where assertion_kind = 'status_update'
    and record_status = 'active'
    and is_current = true
    and subject_entity_id is not null;

-- ---------------------------------------------------------------------------
-- assertion_entities
-- ---------------------------------------------------------------------------
create table if not exists assertion_entities (
  id uuid primary key default gen_random_uuid(),
  assertion_id uuid not null references assertions (id) on delete cascade,
  entity_id uuid references entities (id) on delete restrict,
  entity_reference text,
  reference_role text not null check (reference_role in ('subject', 'object', 'related')),
  resolution_status text not null default 'unresolved' check (
    resolution_status in ('resolved', 'ambiguous', 'unresolved')
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_assertion_entities_assertion_id on assertion_entities (assertion_id);

-- ---------------------------------------------------------------------------
-- clarification_requests
-- ---------------------------------------------------------------------------
create table if not exists clarification_requests (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  target_type text not null check (
    target_type in ('entity', 'event', 'assertion', 'task', 'external_action', 'other')
  ),
  target_reference text not null,
  normalized_target_reference text not null,
  issue_type text not null,
  question text not null,
  reason text not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  blocking_scope text not null check (
    blocking_scope in ('none', 'knowledge_confirmation', 'task_execution', 'external_action')
  ),
  materiality text not null check (materiality in ('blocking', 'non_blocking')),
  suggested_answers jsonb not null default '[]'::jsonb,
  source_excerpt text not null,
  source_block_reference text,
  status text not null default 'pending' check (
    status in ('pending', 'answered', 'dismissed', 'resolved_automatically')
  ),
  answer text,
  answered_at timestamptz,
  record_status text not null default 'candidate' check (
    record_status in ('candidate', 'active', 'superseded', 'rejected')
  ),
  correction_id uuid references corrections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clarification_requests_status on clarification_requests (status);
create index if not exists idx_clarification_requests_inbox_item_id on clarification_requests (inbox_item_id);
create unique index if not exists idx_clarification_requests_dedup_pending
  on clarification_requests (inbox_item_id, issue_type, normalized_target_reference)
  where status = 'pending' and record_status = 'active';

-- ---------------------------------------------------------------------------
-- entity_resolution_logs
-- ---------------------------------------------------------------------------
create table if not exists entity_resolution_logs (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete cascade,
  extraction_run_id uuid references inbox_extraction_runs (id),
  mention_text text not null,
  resolution_status text not null check (
    resolution_status in ('resolved', 'unresolved', 'ambiguous_multiple_matches')
  ),
  resolved_entity_id uuid references entities (id),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_entity_resolution_logs_inbox_item_id
  on entity_resolution_logs (inbox_item_id);

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------
create table if not exists policies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  category text not null,
  operation text not null default 'all',
  scope_type text not null default 'global',
  scope_id text,
  enforcement_stage text not null default 'before_generation',
  enforcement_mode text not null default 'prompt_instruction',
  content text not null,
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_policies_status on policies (status);

-- ---------------------------------------------------------------------------
-- RLS (service_role bypasses; deny anon/authenticated by default)
-- ---------------------------------------------------------------------------
alter table inbox_items enable row level security;
alter table corrections enable row level security;
alter table inbox_extraction_runs enable row level security;
alter table entities enable row level security;
alter table entity_aliases enable row level security;
alter table entity_alias_evidences enable row level security;
alter table inbox_item_entities enable row level security;
alter table tasks enable row level security;
alter table task_mutations enable row level security;
alter table events enable row level security;
alter table event_entities enable row level security;
alter table assertions enable row level security;
alter table assertion_entities enable row level security;
alter table clarification_requests enable row level security;
alter table entity_resolution_logs enable row level security;
alter table policies enable row level security;

notify pgrst, 'reload schema';
