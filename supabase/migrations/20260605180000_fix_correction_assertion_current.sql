-- Backfill correction assertion lineage: is_current + supersede stale active rows.
-- Idempotent — safe to re-run.

-- 1. Latest active assertion per corrected inbox → is_current = true
update assertions a
set is_current = true
from (
  select distinct on (inbox_item_id) id
  from assertions
  where record_status = 'active'
    and inbox_item_id in (select distinct inbox_item_id from corrections)
  order by inbox_item_id, created_at desc
) latest
where a.id = latest.id
  and a.is_current = false;

-- 2. Supersede older active assertions on same inbox (keep 1 current, 0 stale active)
update assertions a
set record_status = 'superseded',
    is_current = false
from (
  select id,
    row_number() over (
      partition by inbox_item_id
      order by is_current desc, created_at desc
    ) as rn
  from assertions
  where record_status = 'active'
    and inbox_item_id in (select distinct inbox_item_id from corrections)
) ranked
where a.id = ranked.id
  and ranked.rn > 1;
