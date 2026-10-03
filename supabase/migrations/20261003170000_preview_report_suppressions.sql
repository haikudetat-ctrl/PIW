-- Addresses that unsubscribed from preview report emails, per company. A
-- saved report the homeowner explicitly requests is still sent; reminders are
-- never sent to a suppressed address.

create table public.property_preview_email_suppressions (
  company_id uuid not null references public.companies(id) on delete cascade,
  email_normalized text not null
    check (email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized))
      and pg_catalog.length(email_normalized) between 3 and 320),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (company_id, email_normalized)
);

alter table public.property_preview_email_suppressions enable row level security;
revoke all on public.property_preview_email_suppressions from public, anon, authenticated;
grant select, insert on public.property_preview_email_suppressions to service_role;
