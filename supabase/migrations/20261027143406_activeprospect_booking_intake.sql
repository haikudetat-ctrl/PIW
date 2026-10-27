-- Operational booking intake is separate from observational shadow checkpoints.
create table public.activeprospect_intake_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flow_id text not null,
  external_lead_id text not null,
  is_test boolean not null,
  appointment_type text not null check (appointment_type in ('virtual','in_home')),
  contact_owner text not null check (contact_owner in ('piw','external')),
  state text not null check (state in ('accepted','linked','external','test','needs_review','ownership_conflict')),
  payload jsonb not null,
  lead_id uuid,
  event_id uuid references public.domain_events(id),
  received_at timestamptz not null default now(),
  unique (company_id, flow_id, external_lead_id, is_test),
  foreign key (company_id, lead_id) references public.leads(company_id, id)
);
create index activeprospect_receipts_company_received_idx
  on public.activeprospect_intake_receipts(company_id, received_at desc);

create table public.booking_contact_ownership (
  company_id uuid not null references public.companies(id),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  contact_owner text not null check (contact_owner in ('piw','external')),
  lead_id uuid,
  created_at timestamptz not null default now(),
  primary key (company_id, phone_e164),
  foreign key (company_id, lead_id) references public.leads(company_id, id)
);

alter table public.activeprospect_intake_receipts enable row level security;
alter table public.booking_contact_ownership enable row level security;
revoke all on public.activeprospect_intake_receipts, public.booking_contact_ownership from public, anon, authenticated;
grant all on public.activeprospect_intake_receipts, public.booking_contact_ownership to service_role;
grant select on public.activeprospect_intake_receipts, public.booking_contact_ownership to authenticated;
create policy "managers read company intake receipts" on public.activeprospect_intake_receipts
  for select to authenticated using (
    company_id = (select public.current_member_company_id())
    and (select public.has_company_role('manager'))
  );
create policy "managers read company contact ownership" on public.booking_contact_ownership
  for select to authenticated using (
    company_id = (select public.current_member_company_id())
    and (select public.has_company_role('manager'))
  );

create function public.accept_activeprospect_booking_intake(
  p_company_id uuid, p_flow_id text, p_appointment_type text,
  p_contact_owner text, p_payload jsonb
) returns table (receipt_id uuid, state text, lead_id uuid, duplicate boolean, event jsonb)
language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt public.activeprospect_intake_receipts;
  v_owner public.booking_contact_ownership;
  v_created record;
  v_id uuid := gen_random_uuid();
  v_event_id uuid;
  v_event jsonb;
  v_now timestamptz := now();
  v_phone text := nullif(p_payload#>>'{lead,phone}', '');
  v_email text := nullif(p_payload#>>'{lead,email}', '');
  v_name text := nullif(pg_catalog.btrim(p_payload#>>'{lead,name}'), '');
  v_address text := nullif(pg_catalog.btrim(p_payload#>>'{lead,submitted_address}'), '');
  v_test boolean;
  v_sms boolean := false;
  v_state text := 'needs_review';
  v_lead_id uuid;
  v_existing_ids uuid[];
  v_ambiguous boolean := false;
begin
  if p_company_id is null or p_flow_id is null or p_appointment_type is null or p_contact_owner is null
     or p_appointment_type not in ('virtual','in_home') or p_contact_owner not in ('piw','external')
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'schema_version' is distinct from '1'
     or p_payload->>'flow_id' is distinct from p_flow_id
     or coalesce(pg_catalog.length(pg_catalog.btrim(p_payload->>'lead_id')),0) not between 1 and 200
     or pg_catalog.jsonb_typeof(p_payload->'is_test') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_payload->'lead') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_payload->'source') is distinct from 'object'
     or coalesce(pg_catalog.octet_length(p_payload::text),0) > 65536 then
    raise exception 'Invalid ActiveProspect intake' using errcode = '22023';
  end if;
  v_test := (p_payload->>'is_test')::boolean;
  -- Identical deliveries serialize before any graph or contact work.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array('ap-receipt',p_company_id,p_flow_id,p_payload->>'lead_id',v_test)::text,0));
  select r.* into v_receipt from public.activeprospect_intake_receipts r
    where r.company_id=p_company_id and r.flow_id=p_flow_id
      and r.external_lead_id=p_payload->>'lead_id' and r.is_test=v_test;
  if found then
    if v_receipt.payload <> p_payload or v_receipt.appointment_type <> p_appointment_type or v_receipt.contact_owner <> p_contact_owner then
      raise exception 'ActiveProspect replay conflict' using errcode='22000';
    end if;
    select e.payload into v_event from public.domain_events e where e.id=v_receipt.event_id and e.company_id=p_company_id;
    return query select v_receipt.id,v_receipt.state,v_receipt.lead_id,true,v_event;
    return;
  end if;

  if v_test then
    v_state := 'test';
  elsif v_phone is null or v_phone !~ '^\+1[2-9][0-9]{9}$' then
    v_state := 'needs_review';
  else
    -- Different source IDs/flows for one phone must converge on one owner.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array('ap-contact',p_company_id,v_phone)::text,0));
    insert into public.booking_contact_ownership(company_id,phone_e164,contact_owner)
      values (p_company_id,v_phone,p_contact_owner) on conflict do nothing;
    select o.* into v_owner from public.booking_contact_ownership o
      where o.company_id=p_company_id and o.phone_e164=v_phone for update;
    if v_owner.contact_owner='piw' and p_contact_owner='piw' and v_owner.lead_id is null then
      -- Returning site/vendor contacts must not restart the initial cadence.
      -- Multiple existing graphs for a phone need a manager's decision.
      select pg_catalog.array_agg(l.id) into v_existing_ids from public.leads l
        where l.company_id=p_company_id and not l.is_test
          and (l.phone_e164=v_phone or (l.phone_e164 is null and
            pg_catalog.regexp_replace(l.phone,'[^0-9]','','g') in
              (pg_catalog.substr(v_phone,3),pg_catalog.substr(v_phone,2))));
      if pg_catalog.array_length(v_existing_ids,1)=1 then
        v_owner.lead_id := v_existing_ids[1];
        update public.booking_contact_ownership o set lead_id=v_owner.lead_id
          where o.company_id=p_company_id and o.phone_e164=v_phone;
      elsif pg_catalog.array_length(v_existing_ids,1)>1 then
        v_ambiguous := true;
      end if;
    end if;
    if v_owner.contact_owner <> p_contact_owner then
      v_state := 'ownership_conflict';
    elsif p_contact_owner='external' then
      v_state := 'external';
    elsif v_owner.lead_id is not null then
      v_state := 'linked';
      v_lead_id := v_owner.lead_id;
    elsif not v_ambiguous and v_name is not null and v_address is not null and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      select * into v_created from public.submit_lead_intake_from_source(
        p_company_id,v_name,v_phone,v_email,v_address,null,v_id,1,'activeprospect_booking',
        pg_catalog.jsonb_build_array(p_flow_id,p_payload->>'lead_id')::text,
        p_flow_id,p_payload->>'lead_id',coalesce(p_payload#>>'{source,name}',p_payload#>>'{source,id}'),
        null,p_payload#>>'{sms_consent,disclosure}',p_payload#>>'{sms_consent,evidence_url}',false,v_phone,v_email);
      v_lead_id := v_created.lead_id;
      v_state := 'accepted';
      update public.booking_contact_ownership o set lead_id=v_lead_id
        where o.company_id=p_company_id and o.phone_e164=v_phone;
      v_sms := coalesce(
        p_payload#>'{sms_consent,granted}' = 'true'::jsonb
        and p_payload#>>'{sms_consent,company_id}' = p_company_id::text
        and pg_catalog.length(pg_catalog.btrim(p_payload#>>'{sms_consent,disclosure}')) > 0
        and p_payload#>>'{sms_consent,evidence_url}' like 'https://%'
        and (p_payload#>>'{sms_consent,captured_at}')::timestamptz <= v_now
        and (p_payload#>>'{sms_consent,captured_at}')::timestamptz <= (p_payload->>'submitted_at')::timestamptz,
        false);
      insert into public.lead_consents(company_id,lead_id,consent_type,granted,disclosure_version,source,granted_at)
        values (p_company_id,v_lead_id,'sms_contact',v_sms,'activeprospect-booking-v1','activeprospect_intake',
          case when v_sms then (p_payload#>>'{sms_consent,captured_at}')::timestamptz else v_now end)
        on conflict on constraint lead_consents_lead_id_consent_type_key do nothing;
      insert into public.tasks(company_id,lead_id,title,description,due_at)
        values (p_company_id,v_lead_id,
          case when p_appointment_type='virtual' then 'Contact new virtual inspection lead' else 'Contact new in-home inspection lead' end,
          case when v_sms then 'Use approved messages or call to arrange the inspection.' else 'Call only: verified SMS consent is not recorded.' end,v_now);
      v_event_id := gen_random_uuid();
      v_event := pg_catalog.jsonb_build_object(
        'id',v_event_id,'name','crm/lead.submitted','schemaVersion',1,'correlationId',v_id,
        'pipelineRunId',v_created.pipeline_run_id,'leadId',v_lead_id,'propertyId',v_created.property_id,
        'occurredAt',pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'idempotencyKey','activeprospect-booking:'||v_id::text,
        'data',pg_catalog.jsonb_build_object('leadId',v_lead_id,'propertyId',v_created.property_id,
          'name',v_name,'phone',v_phone,'email',v_email,'submittedAddress',v_address,'serviceRequested','roofing'));
      perform public.enqueue_domain_event(p_company_id,v_event);
    end if;
  end if;

  insert into public.activeprospect_intake_receipts(id,company_id,flow_id,external_lead_id,is_test,
    appointment_type,contact_owner,state,payload,lead_id,event_id,received_at)
    values (v_id,p_company_id,p_flow_id,p_payload->>'lead_id',v_test,p_appointment_type,
      p_contact_owner,v_state,p_payload,v_lead_id,v_event_id,v_now);
  return query select v_id,v_state,v_lead_id,false,v_event;
end;
$$;
revoke all on function public.accept_activeprospect_booking_intake(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.accept_activeprospect_booking_intake(uuid,text,text,text,jsonb) to service_role;
