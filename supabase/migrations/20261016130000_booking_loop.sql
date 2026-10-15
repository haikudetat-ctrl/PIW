-- Booking loop: the pieces that let Rake take over from BookingBot.
--
--   1. LeadConduit vendor leads become Rake leads with a call task, so the
--      call center works one queue instead of the BookingBot / Gmail lists.
--   2. Tasks carry an optional source_key so system-created tasks (call now,
--      rebook a no-show) are created once however often their trigger fires.
--   3. JobNimbus no-shows on a Rake lead's customer reopen a rebook task.

alter table public.tasks add column source_key text
  check (source_key is null or length(btrim(source_key)) > 0);

create unique index tasks_source_key_idx
  on public.tasks (company_id, source_key)
  where source_key is not null;

-- -----------------------------------------------------------------------------
-- LeadConduit lead intake
-- -----------------------------------------------------------------------------

-- Called by the LeadConduit receiver at the `delivered` checkpoint, i.e. for
-- leads that passed every filter in the flow. Returns the Rake lead and how it
-- was found:
--   existing_piw_lead          the lead started in Rake (piw_lead_id echoed back)
--   existing_leadconduit_lead  this LeadConduit lead was already taken in
--   matched_contact            same phone or email as a lead from the last 30 days
--   created                    a new lead, with its call task and notification
create function public.intake_leadconduit_lead(
  p_company_id uuid,
  p_flow_id text,
  p_flow_name text,
  p_leadconduit_lead_id text,
  p_piw_lead_id uuid,
  p_name text,
  p_phone text,
  p_phone_e164 text,
  p_email text,
  p_email_normalized text,
  p_submitted_address text,
  p_source_name text,
  p_trustedform_url text,
  p_is_test boolean,
  p_correlation_id uuid
) returns table (lead_id uuid, outcome text)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_lead_id uuid;
  v_phone_digits text := pg_catalog.right(pg_catalog.regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  if p_piw_lead_id is not null then
    select lead.id into v_lead_id
    from public.leads as lead
    where lead.id = p_piw_lead_id and lead.company_id = p_company_id;
    if v_lead_id is not null then
      return query select v_lead_id, 'existing_piw_lead'::text;
      return;
    end if;
  end if;

  -- The same person can arrive through both flows at once (Rake fans a lead
  -- out to Roofing and Roofing Virtual Quote), so serialize on the contact,
  -- not only on the LeadConduit lead ID.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':leadconduit-intake:'
        || coalesce(nullif(v_phone_digits, ''), p_email_normalized, p_leadconduit_lead_id),
      0
    )
  );

  select lead.id into v_lead_id
  from public.leads as lead
  where lead.company_id = p_company_id
    and lead.source_system = 'leadconduit'
    and lead.external_lead_id = p_leadconduit_lead_id;
  if v_lead_id is not null then
    return query select v_lead_id, 'existing_leadconduit_lead'::text;
    return;
  end if;

  select lead.id into v_lead_id
  from public.leads as lead
  where lead.company_id = p_company_id
    and lead.is_test = p_is_test
    and lead.created_at > now() - interval '30 days'
    and (
      (pg_catalog.length(v_phone_digits) = 10 and (
        lead.phone_e164 = p_phone_e164
        or pg_catalog.right(pg_catalog.regexp_replace(lead.phone, '\D', '', 'g'), 10) = v_phone_digits
      ))
      or (p_email_normalized is not null and (
        lead.email_normalized = p_email_normalized
        or pg_catalog.lower(pg_catalog.btrim(lead.email)) = p_email_normalized
      ))
    )
  order by lead.created_at desc
  limit 1;
  if v_lead_id is not null then
    return query select v_lead_id, 'matched_contact'::text;
    return;
  end if;

  select intake.lead_id into v_lead_id
  from public.submit_lead_intake_from_source(
    p_company_id => p_company_id,
    p_name => p_name,
    p_phone => p_phone,
    p_email => p_email,
    p_submitted_address => p_submitted_address,
    p_notes => null,
    p_correlation_id => p_correlation_id,
    p_pipeline_version => 1,
    p_source_system => 'leadconduit',
    p_external_lead_id => p_leadconduit_lead_id,
    p_source_account_id => p_flow_id,
    p_original_lead_source => p_source_name,
    p_campaign => p_flow_name,
    p_trustedform_url => p_trustedform_url,
    p_is_test => p_is_test,
    p_phone_e164 => p_phone_e164,
    p_email_normalized => p_email_normalized
  ) as intake;

  insert into public.lead_stage_history (company_id, lead_id, from_stage, to_stage, changed_by)
  values (p_company_id, v_lead_id, null, 'new', null)
  on conflict (lead_id) where from_stage is null do nothing;

  insert into public.notifications (company_id, lead_id, type, title, body, correlation_id)
  values (
    p_company_id, v_lead_id, 'lead_submitted', 'New lead: ' || p_name,
    coalesce(nullif(pg_catalog.btrim(p_source_name), ''), 'A vendor')
      || ' lead from ' || p_flow_name || ' is ready to call.',
    p_correlation_id
  );

  insert into public.tasks (company_id, lead_id, title, description, due_at, source_key)
  values (
    p_company_id, v_lead_id, 'Call new lead now',
    'Call ' || p_name || ' at ' || p_phone || ' and book an inspection.',
    now(), 'call:leadconduit:' || p_leadconduit_lead_id
  )
  on conflict (company_id, source_key) where source_key is not null do nothing;

  return query select v_lead_id, 'created'::text;
end;
$$;

revoke all on function public.intake_leadconduit_lead(
  uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.intake_leadconduit_lead(
  uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, boolean, uuid
) to service_role;

-- -----------------------------------------------------------------------------
-- JobNimbus no-shows → rebook tasks
-- -----------------------------------------------------------------------------

-- Run after refresh_customer_journey. A JobNimbus job that moved to No Show in
-- the last p_lookback, on a customer that has a Rake lead, gets one open
-- "Rebook" task on that lead. Leads already won or lost, or with a later
-- appointment booked in Rake, are left alone. Returns the tasks created.
create function public.queue_jobnimbus_rebook_tasks(
  p_company_id uuid,
  p_lookback interval default interval '14 days'
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  insert into public.tasks (company_id, lead_id, title, description, due_at, source_key)
  select distinct on (lead.id, event.source_ref, event.occurred_at)
    p_company_id,
    lead.id,
    'Rebook no-show',
    'JobNimbus marked the ' || pg_catalog.to_char(event.occurred_at at time zone 'America/New_York', 'Mon DD')
      || ' appointment a no-show. Call ' || lead.name || ' at ' || lead.phone || ' to rebook.',
    now(),
    'rebook:jobnimbus_job:' || event.source_ref || ':'
      || pg_catalog.to_char(event.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
  from public.customer_journey_events as event
  join public.customer_identities as identity
    on identity.company_id = event.company_id
   and identity.customer_id = event.customer_id
   and identity.source_system = 'piw_lead'
  join public.leads as lead
    on lead.company_id = event.company_id
   and lead.id::text = identity.external_id
  where event.company_id = p_company_id
    and event.stage = 'appointment_no_show'
    and event.source_system = 'jobnimbus_job'
    and not event.is_approximate
    and event.occurred_at > now() - p_lookback
    and not lead.is_test
    and lead.stage not in ('won', 'lost')
    and not exists (
      select 1 from public.appointments as appointment
      where appointment.company_id = p_company_id
        and appointment.lead_id = lead.id
        and appointment.status in ('scheduled', 'confirmed')
        and appointment.created_at > event.occurred_at
    )
  on conflict (company_id, source_key) where source_key is not null do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

revoke all on function public.queue_jobnimbus_rebook_tasks(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.queue_jobnimbus_rebook_tasks(uuid, interval)
  to service_role;
