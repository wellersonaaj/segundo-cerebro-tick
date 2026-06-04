-- Segundo Cérebro — legacy insert defaults (MVP)
-- Migration 005 (idempotent: safe to re-run; no DROP; preserves data)

-- ---------------------------------------------------------------------------
-- entities.canonical_name (legacy NOT NULL without default)
-- ---------------------------------------------------------------------------
alter table entities add column if not exists canonical_name text;

update entities
set canonical_name = coalesce(name, normalized_name, 'unknown')
where canonical_name is null;

alter table entities alter column canonical_name set not null;

-- ---------------------------------------------------------------------------
-- Timestamp defaults for NOT NULL columns missing server-side defaults
-- (common in legacy/partial schemas aligned by 004)
-- ---------------------------------------------------------------------------
alter table inbox_items alter column created_at set default now();
alter table inbox_items alter column updated_at set default now();

alter table entities alter column created_at set default now();
alter table entities alter column updated_at set default now();

alter table events alter column created_at set default now();

alter table event_entities alter column created_at set default now();

alter table assertions alter column created_at set default now();

alter table tasks alter column created_at set default now();
alter table tasks alter column updated_at set default now();

alter table entity_aliases alter column created_at set default now();

alter table entity_resolution_logs alter column created_at set default now();

alter table clarification_requests alter column created_at set default now();
alter table clarification_requests alter column updated_at set default now();

alter table corrections alter column created_at set default now();

notify pgrst, 'reload schema';
