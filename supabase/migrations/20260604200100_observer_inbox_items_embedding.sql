-- CEREBRO.OBSERVER — Etapa 1
-- Adiciona coluna embedding (text-embedding-3-small = 1536 dim) em inbox_items.
-- HNSW index para cosine similarity rápido.
-- Idempotente.

alter table inbox_items
  add column if not exists embedding vector(1536);

-- HNSW com cosine. m=16, ef_construction=64 são defaults razoáveis.
-- Para datasets grandes (>100k), considerar IVF flat ou aumentar ef.
create index if not exists idx_inbox_items_embedding_hnsw
  on inbox_items
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
