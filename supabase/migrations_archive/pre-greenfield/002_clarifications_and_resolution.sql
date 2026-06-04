-- Segundo Cérebro — clarifications, entity resolution, corrections
-- Migration 002

-- ---------------------------------------------------------------------------
-- entity_aliases
-- ---------------------------------------------------------------------------
create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities (id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  unique (normalized_alias)
);

create index if not exists idx_entity_aliases_entity_id on entity_aliases (entity_id);

-- ---------------------------------------------------------------------------
-- entity_resolution_logs
-- ---------------------------------------------------------------------------
create table if not exists entity_resolution_logs (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete cascade,
  extracted_entity_name text not null,
  resolution_status text not null check (
    resolution_status in ('resolved', 'unresolved', 'ambiguous_multiple_matches')
  ),
  resolved_entity_id uuid references entities (id),
  resolution_method text,
  confidence numeric(4, 3),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_entity_resolution_logs_inbox_item_id
  on entity_resolution_logs (inbox_item_id);

-- ---------------------------------------------------------------------------
-- clarification_requests
-- ---------------------------------------------------------------------------
create table if not exists clarification_requests (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete cascade,
  target_type text not null check (
    target_type in ('entity', 'event', 'assertion', 'task', 'external_action', 'other')
  ),
  target_reference text not null,
  issue_type text not null check (
    issue_type in (
      'ambiguous_entity_type',
      'ambiguous_entity_identity',
      'ambiguous_alias_conflict',
      'missing_task_target',
      'missing_external_action_target',
      'missing_date',
      'missing_context',
      'other'
    )
  ),
  question text not null,
  reason text not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  blocking_scope text not null check (
    blocking_scope in ('none', 'knowledge_confirmation', 'task_execution', 'external_action')
  ),
  suggested_answers jsonb not null default '[]'::jsonb,
  source_excerpt text not null,
  status text not null default 'pending' check (
    status in ('pending', 'answered', 'dismissed', 'resolved_automatically')
  ),
  answer text,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clarification_requests_status on clarification_requests (status);
create index if not exists idx_clarification_requests_inbox_item_id
  on clarification_requests (inbox_item_id);

-- ---------------------------------------------------------------------------
-- corrections (preserve history)
-- ---------------------------------------------------------------------------
create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  correction_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_corrections_inbox_item_id on corrections (inbox_item_id);

-- Add FK from events/assertions/tasks to corrections after table exists
alter table events
  add constraint fk_events_correction
  foreign key (correction_id) references corrections (id);

alter table assertions
  add constraint fk_assertions_correction
  foreign key (correction_id) references corrections (id);

alter table tasks
  add constraint fk_tasks_correction
  foreign key (correction_id) references corrections (id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table entity_aliases enable row level security;
alter table entity_resolution_logs enable row level security;
alter table clarification_requests enable row level security;
alter table corrections enable row level security;
