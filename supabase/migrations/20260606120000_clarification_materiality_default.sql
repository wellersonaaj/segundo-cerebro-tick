-- 20260606120000_clarification_materiality_default.sql
-- 
-- Defense in depth: clarity_requests.materiality has NOT NULL + CHECK
-- ('blocking', 'non_blocking'). The d417665 application-level fix
-- (materialityFromFields) covers all known insert paths, but a deploy
-- with stale code OR a future code path that forgets to set materiality
-- still violates the constraint.
--
-- Add a DEFAULT of 'non_blocking' (the safe choice — never block
-- extraction on a missing field). This silently turns NOT NULL
-- violations into non-blocking clarifications instead of aborting the
-- entire extraction, which is the right safety behavior.

alter table public.clarification_requests
  alter column materiality set default 'non_blocking';
