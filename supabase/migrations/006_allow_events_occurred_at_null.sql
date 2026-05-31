-- Segundo Cérebro — allow events.occurred_at NULL when the source text has no date
-- Migration 006 (idempotent: safe to re-run; no DROP; preserves data)
--
-- Semântica:
--   inbox_items.received_at = quando a entrada chegou ao sistema
--   events.occurred_at      = quando o acontecimento ocorreu (null se desconhecido)
--   events.created_at       = quando o registro foi persistido

alter table events
  alter column occurred_at drop not null;

notify pgrst, 'reload schema';
