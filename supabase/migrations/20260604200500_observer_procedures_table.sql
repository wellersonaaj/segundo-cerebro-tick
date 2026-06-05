-- CEREBRO.OBSERVER — Etapa 1
-- Tabela procedures: representa os procedimentos do time/negócio.
-- Steps armazenados como jsonb array de objetos {action, owner_entity_id, description}.
-- Embedding do name+description para retrieval ("qual nosso procedimento pra X?").
-- Idempotente.

create table if not exists procedures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  steps jsonb not null default '[]'::jsonb,
  owner_entity_id uuid references entities (id) on delete set null,
  source_inbox_item_id uuid references inbox_items (id) on delete set null,
  embedding vector(1536),
  tsv tsvector generated always as (
    to_tsvector('portuguese', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_procedures_owner on procedures (owner_entity_id);
create index if not exists idx_procedures_active on procedures (is_active) where is_active = true;
create index if not exists idx_procedures_embedding_hnsw
  on procedures
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index if not exists idx_procedures_tsv
  on procedures
  using gin (tsv);

alter table procedures enable row level security;
