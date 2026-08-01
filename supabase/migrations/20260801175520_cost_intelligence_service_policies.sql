-- Make the intended service-only access model explicit to the database linter.
-- service_role already bypasses RLS, but these policies document the only role
-- allowed to manage billing metadata and avoid ambiguous policy-free tables.

create policy "service role manages cost resource inventory"
  on public.cost_resource_inventory for all to service_role
  using (true) with check (true);
create policy "service role manages cost rate cards"
  on public.cost_rate_cards for all to service_role
  using (true) with check (true);
create policy "service role manages cost budget targets"
  on public.cost_budget_targets for all to service_role
  using (true) with check (true);
create policy "service role manages cost collection runs"
  on public.cost_collection_runs for all to service_role
  using (true) with check (true);
create policy "service role manages cost line items"
  on public.cost_line_items for all to service_role
  using (true) with check (true);
