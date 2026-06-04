-- 012: Registry lifecycle + entity_alias_evidences

alter table entities add column if not exists registry_status text not null default 'active';
alter table entities add column if not exists created_by_extraction_run_id uuid references inbox_extraction_runs (id);

alter table entity_aliases add column if not exists registry_status text not null default 'active';
alter table entity_aliases add column if not exists created_by_extraction_run_id uuid references inbox_extraction_runs (id);

alter table entities drop constraint if exists entities_registry_status_check;
alter table entities add constraint entities_registry_status_check
  check (registry_status in ('candidate', 'active', 'superseded'));

alter table entity_aliases drop constraint if exists entity_aliases_registry_status_check;
alter table entity_aliases add constraint entity_aliases_registry_status_check
  check (registry_status in ('candidate', 'active', 'superseded'));

create index if not exists idx_entities_registry_active
  on entities (normalized_name)
  where registry_status = 'active';

create index if not exists idx_entity_aliases_registry_active
  on entity_aliases (normalized_alias)
  where registry_status = 'active';

create table if not exists entity_alias_evidences (
  id uuid primary key default gen_random_uuid(),
  entity_alias_id uuid not null references entity_aliases (id) on delete cascade,
  inbox_item_id uuid not null references inbox_items (id) on delete restrict,
  extraction_run_id uuid not null references inbox_extraction_runs (id) on delete restrict,
  source_excerpt text not null default '',
  confidence numeric(4, 3),
  record_status text not null default 'candidate',
  created_at timestamptz not null default now(),
  unique (entity_alias_id, extraction_run_id, source_excerpt)
);

alter table entity_alias_evidences drop constraint if exists entity_alias_evidences_record_status_check;
alter table entity_alias_evidences add constraint entity_alias_evidences_record_status_check
  check (record_status in ('candidate', 'active', 'superseded'));

create index if not exists idx_entity_alias_evidences_run
  on entity_alias_evidences (extraction_run_id);

alter table entity_alias_evidences enable row level security;

notify pgrst, 'reload schema';
