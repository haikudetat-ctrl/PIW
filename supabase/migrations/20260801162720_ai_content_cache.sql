create extension if not exists vector with schema extensions;

create table public.ai_content_cache (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (length(trim(content_type)) > 0),
  context_key text not null check (length(trim(context_key)) > 0),
  generated_text text not null check (length(trim(generated_text)) > 0),
  embedding extensions.vector(1536),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_type, context_key)
);

create index ai_content_cache_exact_lookup_idx
  on public.ai_content_cache (content_type, context_key, approval_status);

create index ai_content_cache_embedding_idx
  on public.ai_content_cache
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null and approval_status = 'approved';

alter table public.ai_content_cache enable row level security;

revoke all on table public.ai_content_cache from anon, authenticated;

create or replace function public.lookup_ai_content_cache(
  p_content_type text,
  p_context_key text,
  p_query_embedding extensions.vector(1536) default null,
  p_similarity_threshold double precision default 0.75
)
returns table (
  id uuid,
  generated_text text,
  context_key text,
  match_type text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with exact_match as (
    select
      cache.id,
      cache.generated_text,
      cache.context_key,
      'exact'::text as match_type,
      1::double precision as similarity,
      0 as match_rank
    from public.ai_content_cache as cache
    where cache.content_type = p_content_type
      and cache.context_key = p_context_key
      and cache.approval_status = 'approved'
    limit 1
  ),
  semantic_match as (
    select
      cache.id,
      cache.generated_text,
      cache.context_key,
      'semantic'::text as match_type,
      (1 - (cache.embedding operator(extensions.<=>) p_query_embedding))::double precision as similarity,
      1 as match_rank
    from public.ai_content_cache as cache
    where not exists (select 1 from exact_match)
      and p_query_embedding is not null
      and cache.content_type = p_content_type
      and cache.approval_status = 'approved'
      and cache.embedding is not null
      and 1 - (cache.embedding operator(extensions.<=>) p_query_embedding) >= p_similarity_threshold
    order by cache.embedding operator(extensions.<=>) p_query_embedding
    limit 1
  )
  select candidate.id, candidate.generated_text, candidate.context_key,
    candidate.match_type, candidate.similarity
  from (
    select * from exact_match
    union all
    select * from semantic_match
  ) as candidate
  order by candidate.match_rank
  limit 1
$$;

revoke all on function public.lookup_ai_content_cache(
  text, text, extensions.vector, double precision
) from public, anon, authenticated;
