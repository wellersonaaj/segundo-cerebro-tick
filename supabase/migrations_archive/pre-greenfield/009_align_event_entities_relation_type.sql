-- Segundo Cérebro — align event_entities.relation_type NOT NULL + default 'mentioned'
-- Migration 009 (idempotent)

alter table event_entities
  add column if not exists relation_type text;

update event_entities
set relation_type = 'mentioned'
where relation_type is null;

alter table event_entities
  alter column relation_type set default 'mentioned';

alter table event_entities
  alter column relation_type set not null;

notify pgrst, 'reload schema';
