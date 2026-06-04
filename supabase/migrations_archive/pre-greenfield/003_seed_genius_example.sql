-- Optional seed for manual testing of entity alias resolution (Genius → Genius Hotels)
-- Safe to run multiple times (ON CONFLICT DO NOTHING)

insert into entities (
  id,
  name,
  canonical_name,
  entity_type,
  normalized_name
)
values (
  'a0000000-0000-4000-8000-000000000099',
  'Genius Hotels',
  'Genius Hotels',
  'company',
  'genius hotels'
)
on conflict do nothing;

insert into entity_aliases (
  entity_id,
  alias,
  normalized_alias,
  created_at
)
select
  id,
  'Genius',
  'genius',
  now()
from entities
where normalized_name = 'genius hotels'
on conflict (normalized_alias) do nothing;

notify pgrst, 'reload schema';
