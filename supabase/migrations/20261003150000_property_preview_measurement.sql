-- Place and roof-measurement state for property previews. The preview fast
-- path stores the exact Google Place Details result (canonical address and
-- coordinates); the preview measurement worker then reuses or creates the
-- property's Google Solar roof_insights row, which the lead worker finds in its
-- cache after conversion, so a converted preview never pays for Solar twice.

alter table public.property_previews
  add column canonical_address text
    check (canonical_address is null or pg_catalog.length(pg_catalog.btrim(canonical_address)) > 0),
  add column latitude double precision
    check (latitude is null or (latitude between -90 and 90)),
  add column longitude double precision
    check (longitude is null or (longitude between -180 and 180)),
  add column place_resolved_at timestamptz,
  add column measurement_status text not null default 'pending'
    check (measurement_status in ('pending', 'ready', 'no_coverage', 'skipped', 'unavailable')),
  add column roof_insight_id uuid references public.roof_insights(id),
  add constraint property_previews_place_complete_check
    check (
      (canonical_address is null and latitude is null and longitude is null and place_resolved_at is null)
      or (canonical_address is not null and latitude is not null and longitude is not null and place_resolved_at is not null)
    ),
  add constraint property_previews_measured_insight_check
    check (measurement_status not in ('ready', 'no_coverage') or roof_insight_id is not null);
