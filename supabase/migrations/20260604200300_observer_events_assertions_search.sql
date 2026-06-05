-- CEREBRO.OBSERVER — Etapa 1
-- Adiciona embedding + tsvector em events e assertions (memory layer).
-- Idempotente.

-- events: embedding do título + source_excerpt, tsvector do mesmo
alter table events
  add column if not exists embedding vector(1536),
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('portuguese',
      coalesce(title, '') || ' ' || coalesce(source_excerpt, '')
    )
  ) stored;

create index if not exists idx_events_embedding_hnsw
  on events
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_events_tsv
  on events
  using gin (tsv);

-- assertions: embedding do predicate + value_text + source_excerpt
-- Apenas assertions ativas+is_current (se for status_update) ganham embedding
-- (evita embedding de histórico superseded)
alter table assertions
  add column if not exists embedding vector(1536),
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('portuguese',
      coalesce(predicate, '') || ' ' ||
      coalesce(value_text, '') || ' ' ||
      coalesce(source_excerpt, '')
    )
  ) stored;

create index if not exists idx_assertions_embedding_hnsw
  on assertions
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_assertions_tsv
  on assertions
  using gin (tsv);
