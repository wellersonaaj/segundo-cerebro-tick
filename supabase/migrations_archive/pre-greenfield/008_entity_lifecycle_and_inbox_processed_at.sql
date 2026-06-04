-- Segundo Cérebro — processed_at, event_entities.relation_type, ambiguous_alias_conflict
-- Migration 008 (idempotent)

alter table inbox_items add column if not exists processed_at timestamptz;

alter table event_entities add column if not exists relation_type text;

alter table clarification_requests
  drop constraint if exists clarification_requests_issue_type_check;

alter table clarification_requests
  add constraint clarification_requests_issue_type_check
  check (
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
  );

notify pgrst, 'reload schema';
