-- CEREBRO.OBSERVER — Etapa 1
-- Adiciona user_id em inbox_items para suportar multi-usuário futuro.
-- Nullable por enquanto (dados existentes não têm).
-- RLS continua como está (service_role bypassa). Policies multi-user ficam
-- pra Etapa 2 quando tivermos o conceito de "quem é o usuário".
-- Idempotente.

alter table inbox_items
  add column if not exists user_id uuid;

create index if not exists idx_inbox_items_user_id
  on inbox_items (user_id)
  where user_id is not null;
