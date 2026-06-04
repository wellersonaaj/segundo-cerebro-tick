-- Segundo Cérebro — greenfield seeds (Bloco 6A)
-- Idempotent technical seed — no personal bootstrap data

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

insert into entities (
  id,
  name,
  canonical_name,
  entity_type,
  normalized_name,
  registry_status
)
values (
  'a0000000-0000-4000-8000-000000000099',
  'Genius Hotels',
  'Genius Hotels',
  'company',
  'genius hotels',
  'active'
)
on conflict (id) do nothing;

insert into entity_aliases (
  entity_id,
  alias,
  normalized_alias,
  registry_status
)
select
  'a0000000-0000-4000-8000-000000000099',
  'Genius',
  'genius',
  'active'
where not exists (
  select 1 from entity_aliases where normalized_alias = 'genius'
);

notify pgrst, 'reload schema';
