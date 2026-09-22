-- Production applied these website-arrivals service-role grants under this
-- version. Keeping the exact statements aligns fresh/local databases with the
-- verified live schema while preserving production migration history.

revoke all on public.website_arrivals from public, anon, authenticated;
grant select, insert on public.website_arrivals to service_role;

revoke all on public.website_arrivals_daily from public, anon, authenticated;
grant select on public.website_arrivals_daily to service_role;

notify pgrst, 'reload schema';
