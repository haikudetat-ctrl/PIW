-- Setters keep scoped queue access. Only server code may commit after checking
-- the external Google calendar; the transaction revalidates the live claim.
create function private.lock_setter_booking_claim(
  p_company_id uuid, p_user_id uuid, p_task_id uuid, p_claim_token uuid
) returns public.tasks
language plpgsql set search_path='' as $$
declare v_task public.tasks%rowtype;
begin
  if p_company_id is null or p_user_id is null then
    raise exception 'Queue access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('setter-company:'||p_company_id::text,0));
  if not exists (
    select 1 from public.company_setters r
    join public.setter_queue_settings s using(company_id)
    join public.company_memberships m on m.company_id=r.company_id and m.user_id=r.user_id
    where r.company_id=p_company_id and r.user_id=p_user_id and r.enabled and s.enabled and m.is_active
  ) then raise exception 'Queue access required' using errcode='42501'; end if;
  select * into v_task from public.tasks
  where id=p_task_id and company_id=p_company_id for update;
  if not found or v_task.status<>'open' or v_task.queue_bucket is null
    or v_task.claim_user_id is distinct from p_user_id or v_task.claim_token is distinct from p_claim_token
    or v_task.claim_expires_at is null or v_task.claim_expires_at<=pg_catalog.clock_timestamp()
    or not private.setter_eligible(p_company_id,v_task.lead_id)
  then raise exception 'Claim expired or changed; reload the queue' using errcode='40001'; end if;
  return v_task;
end $$;

create function public.get_setter_booking_context(p_task_id uuid,p_claim_token uuid)
returns table(company_id uuid,lead_id uuid,link_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=private.setter_company(false); v_task public.tasks%rowtype; v_link uuid;
begin
  v_task:=private.lock_setter_booking_claim(v_company,auth.uid(),p_task_id,p_claim_token);
  select b.link_id into v_link from public.ensure_booking_link(v_company,v_task.lead_id,'staff',auth.uid()) b;
  return query select v_company,v_task.lead_id,v_link;
end $$;

create function public.save_setter_virtual_booking(
  p_company_id uuid,p_user_id uuid,p_task_id uuid,p_claim_token uuid,p_link_id uuid,
  p_action text,p_starts_at timestamptz,p_appointment_id uuid,p_expected_revision bigint,
  p_attendee_email text,p_customer_notes text,p_request_ip inet
) returns table(outcome text,problem text,appointment_id uuid,scheduled_at timestamptz,duration_minutes integer,revision bigint,event jsonb)
language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype; v_link public.booking_links%rowtype;
  v_existing public.appointments%rowtype; v_result record;
begin
  v_task:=private.lock_setter_booking_claim(p_company_id,p_user_id,p_task_id,p_claim_token);
  if p_action is null or p_action not in ('book','reschedule') then
    raise exception 'Choose a supported booking action' using errcode='22023';
  end if;
  -- Match existing lock order: link, then company virtual capacity. Queue
  -- changes use the outer setter-company lock, including SLA claim release.
  v_link:=private.lock_active_booking_link(p_link_id,pg_catalog.clock_timestamp());
  if v_link.company_id<>p_company_id or v_link.lead_id<>v_task.lead_id then
    raise exception 'Claim expired or changed; reload the queue' using errcode='40001';
  end if;
  perform private.lock_virtual_booking(p_company_id);
  if p_action='book' then
    if p_appointment_id is not null or p_expected_revision is not null then
      raise exception 'Booking changed; reload available times' using errcode='40001';
    end if;
    select * into v_result from public.book_virtual_consultation(p_link_id,p_starts_at,p_attendee_email,p_customer_notes,p_request_ip);
    if v_result.outcome='booked' then
      update public.appointments set created_by=p_user_id where id=v_result.appointment_id and company_id=p_company_id;
    end if;
  else
    select * into v_existing from public.appointments a
    where a.company_id=p_company_id and a.lead_id=v_task.lead_id and a.booking_source='self_service'
      and a.meeting_type='virtual' and a.status in ('scheduled','confirmed') for update;
    if not found or v_existing.id is distinct from p_appointment_id or v_existing.revision is distinct from p_expected_revision then
      raise exception 'Booking changed; reload available times' using errcode='40001';
    end if;
    select * into v_result from public.reschedule_virtual_consultation(p_link_id,p_starts_at,p_request_ip);
  end if;
  -- Lock waits (including the inherited per-IP throttle) may outlive the
  -- lease. Raising here rolls back the reservation and its durable event.
  perform private.lock_setter_booking_claim(p_company_id,p_user_id,p_task_id,p_claim_token);
  if v_result.outcome in ('booked','rescheduled') then
    insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,correlation_id,metadata)
    values(p_company_id,p_user_id,'setter_virtual_'||v_result.outcome,'appointment',v_result.appointment_id,v_task.lead_id,
      pg_catalog.jsonb_build_object('taskId',v_task.id,'revision',v_result.revision,'previousRevision',p_expected_revision));
  end if;
  return query select v_result.outcome,v_result.problem,v_result.appointment_id,v_result.scheduled_at,
    v_result.duration_minutes,v_result.revision,v_result.event;
end $$;

revoke all on function private.lock_setter_booking_claim(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_setter_booking_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_setter_booking_context(uuid,uuid) to authenticated;
revoke all on function public.save_setter_virtual_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid,bigint,text,text,inet) from public,anon,authenticated;
grant execute on function public.save_setter_virtual_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid,bigint,text,text,inet) to service_role;
