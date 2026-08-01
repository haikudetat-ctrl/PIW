begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_extension('vector', 'pgvector is enabled');
select has_table('public', 'ai_content_cache', 'ai_content_cache exists');
select columns_are(
  'public',
  'ai_content_cache',
  array[
    'id', 'content_type', 'context_key', 'generated_text', 'embedding',
    'approval_status', 'last_used_at', 'created_at', 'updated_at'
  ],
  'ai_content_cache has the expected columns'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.ai_content_cache'::regclass),
  true,
  'ai_content_cache has RLS enabled'
);
select is(
  has_table_privilege('anon', 'public.ai_content_cache', 'select'),
  false,
  'anonymous users cannot read AI cache content'
);
select is(
  has_table_privilege('authenticated', 'public.ai_content_cache', 'select'),
  false,
  'authenticated users cannot read AI cache content directly'
);
select function_privs_are(
  'public',
  'lookup_ai_content_cache',
  array['text', 'text', 'extensions.vector', 'double precision'],
  'anon',
  array[]::text[],
  'anonymous users cannot call the cache lookup function'
);

insert into public.ai_content_cache (
  id, content_type, context_key, generated_text, embedding, approval_status
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'sales_follow_up',
    'rep:42/install:100',
    'Your roof installation is scheduled for Tuesday.',
    ('[' || array_to_string(array_fill(1::real, array[1536]), ',') || ']')::extensions.vector,
    'approved'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'sales_follow_up',
    'rep:42/install:200',
    'Your installation crew will arrive on Wednesday.',
    ('[' || array_to_string(array_fill(0.99::real, array[1536]), ',') || ']')::extensions.vector,
    'approved'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'sales_follow_up',
    'rep:42/install:draft',
    'This draft must never be served.',
    ('[' || array_to_string(array_fill(1::real, array[1536]), ',') || ']')::extensions.vector,
    'pending'
  );

select is(
  (
    select match_type
    from public.lookup_ai_content_cache(
      'sales_follow_up',
      'rep:42/install:100',
      ('[' || array_to_string(array_fill(0.99::real, array[1536]), ',') || ']')::extensions.vector
    )
  ),
  'exact',
  'exact context key wins over embedding similarity'
);
select is(
  (
    select context_key
    from public.lookup_ai_content_cache(
      'sales_follow_up',
      'rep:unknown/install:unknown',
      ('[' || array_to_string(array_fill(1::real, array[1536]), ',') || ']')::extensions.vector,
      0.9
    )
  ),
  'rep:42/install:100',
  'semantic lookup returns the most similar approved row'
);
select is(
  (
    select count(*)
    from public.lookup_ai_content_cache(
      'sales_follow_up',
      'rep:42/install:draft',
      null,
      0.9
    )
  ),
  0::bigint,
  'pending content is not returned by exact lookup'
);
select is(
  (
    select count(*)
    from public.lookup_ai_content_cache(
      'sales_follow_up',
      'missing',
      null,
      0.9
    )
  ),
  0::bigint,
  'lookup returns no row when neither exact nor semantic input is available'
);

select * from finish();

rollback;
