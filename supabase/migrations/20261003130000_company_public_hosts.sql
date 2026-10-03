-- Customer-branded hosts for the public estimate experience
-- (e.g. estimate.allseasonroofingquote.com). PIW resolves the tenant only from
-- a verified row here, never from the URL or request body. The middleware's
-- route allowlist uses PUBLIC_ESTIMATE_HOSTS so it needs no database call.

create table public.company_public_hosts (
  host text primary key
    check (host = pg_catalog.lower(host)
      and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  company_id uuid not null references public.companies(id) on delete cascade,
  brand jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(brand) = 'object'),
  verified_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index company_public_hosts_company_idx
  on public.company_public_hosts (company_id);

comment on table public.company_public_hosts is
  'Verified customer-branded hosts for the public estimate experience. Service role only.';
comment on column public.company_public_hosts.brand is
  'Display name, logo, privacy/terms URLs and accent color, validated by publicBrandSchema in src/modules/tenancy/public-host.ts.';

alter table public.company_public_hosts enable row level security;

revoke all on public.company_public_hosts from public, anon, authenticated;
grant select, insert, update, delete on public.company_public_hosts to service_role;
