-- CEREBRO.OBSERVER — Etapa 1
-- Funções de retrieval híbrida: BM25 (tsvector) + cosine (embedding) com RRF.
-- Uma função por tabela-alvo — mais simples, planner otimiza cada uma.
--
-- Uso pelo app:
--   1. Gera embedding da query via OpenAI
--   2. Chama a função da tabela certa:
--      SELECT * FROM hybrid_search_inbox_items(
--        '<embedding>'::vector(1536), 'meus compromissos do dia', 20
--      );
--
-- RRF: score = vector_weight / (k + v_rank) + text_weight / (k + t_rank)
-- k=60 é o default da fórmula original.

-- =============================================================================
-- inbox_items
-- =============================================================================
create or replace function hybrid_search_inbox_items(
  p_query_embedding vector(1536),
  p_query_text text default '',
  p_limit int default 20,
  p_vector_weight float default 0.6,
  p_text_weight float default 0.4,
  p_rrf_k int default 60
)
returns table (
  id uuid,
  raw_content text,
  source_channel text,
  occurred_at timestamptz,
  vector_rank int,
  text_rank int,
  combined_score float
)
language sql
stable
as $$
  with v as (
    select i.id, i.raw_content, i.source_channel, i.received_at as occurred_at,
           row_number() over (order by i.embedding <=> p_query_embedding) as rank
    from inbox_items i
    where i.embedding is not null
    order by i.embedding <=> p_query_embedding
    limit greatest(p_limit * 3, 30)
  ),
  t as (
    select i.id, i.raw_content, i.source_channel, i.received_at as occurred_at,
           row_number() over (order by ts_rank(i.tsv, plainto_tsquery('portuguese', p_query_text)) desc) as rank
    from inbox_items i
    where i.tsv @@ plainto_tsquery('portuguese', p_query_text)
    order by ts_rank(i.tsv, plainto_tsquery('portuguese', p_query_text)) desc
    limit greatest(p_limit * 3, 30)
  )
  select
    coalesce(v.id, t.id) as id,
    coalesce(v.raw_content, t.raw_content) as raw_content,
    coalesce(v.source_channel, t.source_channel) as source_channel,
    coalesce(v.occurred_at, t.occurred_at) as occurred_at,
    v.rank::int as vector_rank,
    t.rank::int as text_rank,
    (
      coalesce(p_vector_weight / (p_rrf_k + v.rank), 0) +
      coalesce(p_text_weight / (p_rrf_k + t.rank), 0)
    )::float as combined_score
  from v
  full outer join t on v.id = t.id
  order by combined_score desc
  limit p_limit;
$$;

-- =============================================================================
-- events
-- =============================================================================
create or replace function hybrid_search_events(
  p_query_embedding vector(1536),
  p_query_text text default '',
  p_limit int default 20,
  p_vector_weight float default 0.6,
  p_text_weight float default 0.4,
  p_rrf_k int default 60
)
returns table (
  id uuid,
  raw_content text,
  source_channel text,
  occurred_at timestamptz,
  vector_rank int,
  text_rank int,
  combined_score float
)
language sql
stable
as $$
  with v as (
    select e.id, e.title as raw_content, null::text as source_channel, e.occurred_at,
           row_number() over (order by e.embedding <=> p_query_embedding) as rank
    from events e
    where e.embedding is not null and e.record_status = 'active'
    order by e.embedding <=> p_query_embedding
    limit greatest(p_limit * 3, 30)
  ),
  t as (
    select e.id, e.title as raw_content, null::text as source_channel, e.occurred_at,
           row_number() over (order by ts_rank(e.tsv, plainto_tsquery('portuguese', p_query_text)) desc) as rank
    from events e
    where e.tsv @@ plainto_tsquery('portuguese', p_query_text)
      and e.record_status = 'active'
    order by ts_rank(e.tsv, plainto_tsquery('portuguese', p_query_text)) desc
    limit greatest(p_limit * 3, 30)
  )
  select
    coalesce(v.id, t.id) as id,
    coalesce(v.raw_content, t.raw_content) as raw_content,
    coalesce(v.source_channel, t.source_channel) as source_channel,
    coalesce(v.occurred_at, t.occurred_at) as occurred_at,
    v.rank::int as vector_rank,
    t.rank::int as text_rank,
    (
      coalesce(p_vector_weight / (p_rrf_k + v.rank), 0) +
      coalesce(p_text_weight / (p_rrf_k + t.rank), 0)
    )::float as combined_score
  from v
  full outer join t on v.id = t.id
  order by combined_score desc
  limit p_limit;
$$;

-- =============================================================================
-- assertions
-- =============================================================================
create or replace function hybrid_search_assertions(
  p_query_embedding vector(1536),
  p_query_text text default '',
  p_limit int default 20,
  p_vector_weight float default 0.6,
  p_text_weight float default 0.4,
  p_rrf_k int default 60
)
returns table (
  id uuid,
  raw_content text,
  source_channel text,
  occurred_at timestamptz,
  vector_rank int,
  text_rank int,
  combined_score float
)
language sql
stable
as $$
  with v as (
    select a.id,
           coalesce(a.predicate, '') || ': ' || coalesce(a.value_text, '') as raw_content,
           null::text as source_channel,
           a.created_at as occurred_at,
           row_number() over (order by a.embedding <=> p_query_embedding) as rank
    from assertions a
    where a.embedding is not null and a.record_status = 'active'
    order by a.embedding <=> p_query_embedding
    limit greatest(p_limit * 3, 30)
  ),
  t as (
    select a.id,
           coalesce(a.predicate, '') || ': ' || coalesce(a.value_text, '') as raw_content,
           null::text as source_channel,
           a.created_at as occurred_at,
           row_number() over (order by ts_rank(a.tsv, plainto_tsquery('portuguese', p_query_text)) desc) as rank
    from assertions a
    where a.tsv @@ plainto_tsquery('portuguese', p_query_text)
      and a.record_status = 'active'
    order by ts_rank(a.tsv, plainto_tsquery('portuguese', p_query_text)) desc
    limit greatest(p_limit * 3, 30)
  )
  select
    coalesce(v.id, t.id) as id,
    coalesce(v.raw_content, t.raw_content) as raw_content,
    coalesce(v.source_channel, t.source_channel) as source_channel,
    coalesce(v.occurred_at, t.occurred_at) as occurred_at,
    v.rank::int as vector_rank,
    t.rank::int as text_rank,
    (
      coalesce(p_vector_weight / (p_rrf_k + v.rank), 0) +
      coalesce(p_text_weight / (p_rrf_k + t.rank), 0)
    )::float as combined_score
  from v
  full outer join t on v.id = t.id
  order by combined_score desc
  limit p_limit;
$$;

-- =============================================================================
-- procedures
-- =============================================================================
create or replace function hybrid_search_procedures(
  p_query_embedding vector(1536),
  p_query_text text default '',
  p_limit int default 20,
  p_vector_weight float default 0.6,
  p_text_weight float default 0.4,
  p_rrf_k int default 60
)
returns table (
  id uuid,
  raw_content text,
  source_channel text,
  occurred_at timestamptz,
  vector_rank int,
  text_rank int,
  combined_score float
)
language sql
stable
as $$
  with v as (
    select p.id, p.description as raw_content, p.name as source_channel, p.created_at as occurred_at,
           row_number() over (order by p.embedding <=> p_query_embedding) as rank
    from procedures p
    where p.embedding is not null and p.is_active = true
    order by p.embedding <=> p_query_embedding
    limit greatest(p_limit * 3, 30)
  ),
  t as (
    select p.id, p.description as raw_content, p.name as source_channel, p.created_at as occurred_at,
           row_number() over (order by ts_rank(p.tsv, plainto_tsquery('portuguese', p_query_text)) desc) as rank
    from procedures p
    where p.tsv @@ plainto_tsquery('portuguese', p_query_text)
      and p.is_active = true
    order by ts_rank(p.tsv, plainto_tsquery('portuguese', p_query_text)) desc
    limit greatest(p_limit * 3, 30)
  )
  select
    coalesce(v.id, t.id) as id,
    coalesce(v.raw_content, t.raw_content) as raw_content,
    coalesce(v.source_channel, t.source_channel) as source_channel,
    coalesce(v.occurred_at, t.occurred_at) as occurred_at,
    v.rank::int as vector_rank,
    t.rank::int as text_rank,
    (
      coalesce(p_vector_weight / (p_rrf_k + v.rank), 0) +
      coalesce(p_text_weight / (p_rrf_k + t.rank), 0)
    )::float as combined_score
  from v
  full outer join t on v.id = t.id
  order by combined_score desc
  limit p_limit;
$$;

-- =============================================================================
-- Backward-compat: função dispatcher que escolhe a certa
-- (mantida pra conveniência; chamadas explícitas por tabela são preferíveis)
-- =============================================================================
create or replace function hybrid_search(
  p_query_embedding vector(1536),
  p_query_text text default '',
  p_limit int default 20,
  p_table text default 'inbox_items',
  p_vector_weight float default 0.6,
  p_text_weight float default 0.4,
  p_rrf_k int default 60
)
returns table (
  id uuid,
  raw_content text,
  source_channel text,
  occurred_at timestamptz,
  vector_rank int,
  text_rank int,
  combined_score float
)
language plpgsql
stable
as $$
begin
  if p_table = 'inbox_items' then
    return query select * from hybrid_search_inbox_items(p_query_embedding, p_query_text, p_limit, p_vector_weight, p_text_weight, p_rrf_k);
  elsif p_table = 'events' then
    return query select * from hybrid_search_events(p_query_embedding, p_query_text, p_limit, p_vector_weight, p_text_weight, p_rrf_k);
  elsif p_table = 'assertions' then
    return query select * from hybrid_search_assertions(p_query_embedding, p_query_text, p_limit, p_vector_weight, p_text_weight, p_rrf_k);
  elsif p_table = 'procedures' then
    return query select * from hybrid_search_procedures(p_query_embedding, p_query_text, p_limit, p_vector_weight, p_text_weight, p_rrf_k);
  else
    raise exception 'Tabela não suportada: %', p_table;
  end if;
end;
$$;
