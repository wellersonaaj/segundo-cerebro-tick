-- 20260606110000_assertion_status_update_conflict_trigger.sql
-- 
-- Fix: when persist_extraction_candidates inserts a status_update that would
-- violate the unique partial index idx_assertions_status_update_current
-- (i.e. another active+is_current=true (subject_entity_id, predicate) exists),
-- supersede the old one before the new insert is committed.
--
-- Symptom: 2+ runs on the same inbox (correction + re-extraction, or parallel
-- runs) generate status_updates with the same (subject, predicate). The second
-- one fails the unique partial index, the inbox is saved but the promote aborts
-- and the assertion is silently lost.
--
-- Approach: BEFORE INSERT trigger on `assertions` that pre-emptively marks
-- the existing active+is_current=true assertion as superseded. Cheaper and
-- less invasive than modifying persist_extraction_candidates (300+ lines
-- spread across multiple migrations).
--
-- We do NOT use ON CONFLICT inside the persist RPC because the constraint
-- is a partial unique INDEX (not a CONSTRAINT), and ON CONFLICT in
-- persist_extraction_candidates would force us to re-emit the WHERE clause
-- verbatim, duplicating the schema knowledge. A trigger centralizes it.

create or replace function public.handle_assertion_status_update_conflict()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.assertion_kind = 'status_update'
     and NEW.subject_entity_id is not null
     and NEW.is_current = true
     and NEW.record_status in ('candidate', 'active')
  then
    update public.assertions
      set is_current = false,
          record_status = 'superseded',
          updated_at = now()
      where subject_entity_id = NEW.subject_entity_id
        and predicate = NEW.predicate
        and assertion_kind = 'status_update'
        and record_status = 'active'
        and is_current = true
        and id is distinct from NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_assertion_status_update_conflict on public.assertions;
create trigger trg_assertion_status_update_conflict
  before insert on public.assertions
  for each row execute function public.handle_assertion_status_update_conflict();
