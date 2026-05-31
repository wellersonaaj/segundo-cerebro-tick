-- Segundo Cérebro — align inbox_items.processing_status CHECK with 001 / app contract
-- Migration 007 (idempotent drop/add; no auto-conversion of legacy status values)
--
-- Contrato MVP: pending | processing | completed | failed
-- Legado comum: processed | needs_review | ignored (devem ser corrigidos manualmente antes desta migration)

do $$
declare
  invalid_count integer;
  invalid_sample text;
begin
  select count(*), coalesce(string_agg(distinct processing_status, ', '), '')
  into invalid_count, invalid_sample
  from inbox_items
  where processing_status is not null
    and processing_status not in ('pending', 'processing', 'completed', 'failed');

  if invalid_count > 0 then
    raise exception
      '007_align_inbox_processing_status: % inbox_items com processing_status fora do contrato MVP (pending, processing, completed, failed). Valores encontrados: %. Corrija manualmente antes de aplicar esta migration (sem conversão automática de processed/needs_review/ignored).',
      invalid_count,
      invalid_sample;
  end if;
end $$;

alter table inbox_items
  drop constraint if exists inbox_items_processing_status_check;

alter table inbox_items
  add constraint inbox_items_processing_status_check
  check (
    processing_status in (
      'pending',
      'processing',
      'completed',
      'failed'
    )
  );

notify pgrst, 'reload schema';
