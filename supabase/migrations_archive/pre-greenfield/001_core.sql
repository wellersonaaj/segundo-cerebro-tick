-- Segundo Cérebro — core schema (MVP)
-- Migration 001

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- inbox_items: preserve raw input before interpretation
-- ---------------------------------------------------------------------------
create table if not exists inbox_items (
  id uuid primary key default gen_random_uuid(),
  raw_content text not null,
  source_channel text not null,
  source_mode text not null check (source_mode in ('conversational', 'passive')),
  received_at timestamptz not null,
  timezone text not null default 'UTC',
  processing_status text not null default 'pending' check (
    processing_status in ('pending', 'processing', 'completed', 'failed')
  ),
  extractor_version text,
  processing_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbox_items_processing_status on inbox_items (processing_status);
create index if not exists idx_inbox_items_received_at on inbox_items (received_at desc);

-- ---------------------------------------------------------------------------
-- entities
-- ---------------------------------------------------------------------------
create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity_type text not null check (
    entity_type in (
      'person',
      'company',
      'project',
      'product',
      'topic',
      'document',
      'location',
      'other'
    )
  ),
  normalized_name text not null,
  status text not null default 'active' check (status in ('active', 'superseded', 'merged')),
  superseded_by uuid references entities (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_entities_normalized_name_active
  on entities (normalized_name)
  where status = 'active';

create index if not exists idx_entities_entity_type on entities (entity_type);

-- ---------------------------------------------------------------------------
-- events (append-oriented ledger)
-- ---------------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  event_type text not null,
  description text not null,
  occurred_at timestamptz,
  source_excerpt text not null,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  status text not null default 'active' check (status in ('active', 'superseded', 'invalidated')),
  superseded_by uuid references events (id),
  correction_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_inbox_item_id on events (inbox_item_id);
create index if not exists idx_events_occurred_at on events (occurred_at desc nulls last);
create index if not exists idx_events_event_type on events (event_type);
create index if not exists idx_events_status on events (status);

-- ---------------------------------------------------------------------------
-- event_entities
-- ---------------------------------------------------------------------------
create table if not exists event_entities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete restrict,
  role text,
  relation_type text not null default 'mentioned',
  created_at timestamptz not null default now(),
  unique (event_id, entity_id)
);

create index if not exists idx_event_entities_entity_id on event_entities (entity_id);

-- ---------------------------------------------------------------------------
-- assertions
-- ---------------------------------------------------------------------------
create table if not exists assertions (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  assertion_type text not null check (
    assertion_type in (
      'fact',
      'hypothesis',
      'opinion',
      'decision',
      'commitment',
      'question',
      'assumption',
      'recommendation'
    )
  ),
  content text not null,
  status text not null default 'unverified' check (
    status in (
      'unverified',
      'supported',
      'confirmed',
      'contested',
      'invalidated',
      'superseded'
    )
  ),
  source_excerpt text not null,
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  record_status text not null default 'active' check (record_status in ('active', 'superseded')),
  superseded_by uuid references assertions (id),
  correction_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_assertions_inbox_item_id on assertions (inbox_item_id);
create index if not exists idx_assertions_status on assertions (status);
create index if not exists idx_assertions_record_status on assertions (record_status);

-- ---------------------------------------------------------------------------
-- tasks (projection layer)
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  title text not null,
  description text,
  due_at timestamptz,
  temporal_reference_text text,
  source_excerpt text not null,
  is_commitment boolean not null default false,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled', 'superseded')),
  confidence numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  superseded_by uuid references tasks (id),
  correction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_due_at on tasks (due_at nulls last);

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
create index if not exists idx_policies_operation on policies (operation);

-- Seed baseline policies
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
-- RLS (enabled; service role bypasses; anon/authenticated blocked by default)
-- ---------------------------------------------------------------------------
alter table inbox_items enable row level security;
alter table entities enable row level security;
alter table events enable row level security;
alter table event_entities enable row level security;
alter table assertions enable row level security;
alter table tasks enable row level security;
alter table policies enable row level security;
