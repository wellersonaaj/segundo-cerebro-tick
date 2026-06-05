-- CEREBRO.OBSERVER — Etapa 1
-- Adiciona coluna tsvector (BM25) em inbox_items para full-text search em PT.
-- Generated column → atualiza sozinho no INSERT/UPDATE.
-- GIN index para tsquery.
-- Idempotente.

alter table inbox_items
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('portuguese', coalesce(raw_content, ''))
  ) stored;

create index if not exists idx_inbox_items_tsv
  on inbox_items
  using gin (tsv);
