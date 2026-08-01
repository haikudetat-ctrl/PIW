-- Preserve property-level quote consistency while retaining one estimate row
-- per lead submission. The lineage column makes reuse explicit and auditable.

alter table public.roof_estimates
  add column reused_from_estimate_id uuid
  references public.roof_estimates(id) on delete set null;

create index roof_estimates_reused_from_estimate_id_idx
  on public.roof_estimates(reused_from_estimate_id)
  where reused_from_estimate_id is not null;

create index roof_estimates_reusable_quote_idx
  on public.roof_estimates(company_id, property_id, updated_at desc)
  where status = 'ready';
