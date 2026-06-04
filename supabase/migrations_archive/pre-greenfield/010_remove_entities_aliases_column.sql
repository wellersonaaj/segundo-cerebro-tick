-- Segundo Cérebro — remove redundant entities.aliases (entity_aliases is source of truth)
-- Migration 010 (idempotent)

alter table entities
  drop column if exists aliases;

notify pgrst, 'reload schema';
