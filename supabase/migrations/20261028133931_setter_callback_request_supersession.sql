-- Forward fixes for databases that already applied the setter queue release.
-- Preserve historical migrations; replace only the affected functions.

create or replace function private.setter_assignee_available(p_company uuid,p_assignee uuid) returns boolean
language sql stable set search_path='' as $$
 select p_assignee is null or p_assignee=auth.uid() or not exists(
   select 1 from public.company_setters r join public.company_memberships m using(company_id,user_id)
   where r.company_id=p_company and r.user_id=p_assignee and r.enabled and m.is_active)
$$;

revoke all on function private.setter_assignee_available(uuid,uuid) from public,anon,authenticated;

create or replace function public.claim_setter_task(p_task_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company uuid; v_task public.tasks%rowtype; v_now timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('setter-user:'||auth.uid()::text,0));
 v_company:=private.setter_company(true);
 perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
 -- Also clear abandoned claims in another active-company selection. The
 -- unique user index prevents a switch from bypassing an unfinished claim.
 update public.tasks set claim_user_id=null,claim_token=null,claim_expires_at=null
 where status='open' and claim_expires_at<=v_now and (company_id=v_company or claim_user_id=auth.uid());
 select * into v_task from public.tasks where claim_user_id=auth.uid() and status='open' and claim_expires_at>v_now for update;
 if found then
   if v_task.company_id<>v_company then raise exception 'Finish your claim in the other company first' using errcode='22023'; end if;
   if private.setter_eligible(v_company,v_task.lead_id) then
     update public.tasks set claim_expires_at=v_now+interval '15 minutes' where id=v_task.id returning * into v_task;
     return jsonb_build_object('id',v_task.id,'claim_token',v_task.claim_token);
   end if;
   update public.tasks set status='cancelled',claim_user_id=null,claim_token=null,claim_expires_at=null where id=v_task.id;
 end if;
 select t.* into v_task from public.tasks t join public.leads l on l.id=t.lead_id and l.company_id=t.company_id
 where t.company_id=v_company and t.status='open' and t.queue_bucket is not null and t.claim_user_id is null
   and coalesce(t.due_at,v_now)<=v_now and private.setter_eligible(t.company_id,t.lead_id)
   and (p_task_id is null or t.id=p_task_id)
   and (private.setter_assignee_available(v_company,t.assigned_to) or t.sla_escalated_at is not null
     or (t.claimed_at is not null and t.claim_expires_at is null))
   and not exists(select 1 from public.tasks active where active.company_id=v_company and active.lead_id=t.lead_id and active.status='open' and active.claim_user_id is not null)
   and (t.queue_bucket in ('call_request','scheduled_callback','handoff') or not exists(
     select 1 from public.appointments a where a.company_id=v_company and a.lead_id=t.lead_id and a.status in ('scheduled','confirmed') and a.scheduled_at>v_now))
 order by case t.queue_bucket when 'call_request' then 1 when 'scheduled_callback' then 2
   when 'new_lead' then case when l.created_at>v_now-interval '15 minutes' then 3 else 5 end when 'handoff' then 4 else 5 end,
   t.due_at nulls first,(select max(e.range_high_cents) from public.roof_estimates e where e.company_id=v_company and e.lead_id=t.lead_id) desc nulls last,t.created_at,t.id
 limit 1 for update of t;
 if not found then return null; end if;
 update public.tasks set claim_user_id=auth.uid(),claim_token=gen_random_uuid(),claimed_at=v_now,claim_expires_at=v_now+interval '15 minutes',
   assigned_to=case when queue_bucket in ('call_request','scheduled_callback') then coalesce(assigned_to,auth.uid()) else assigned_to end
 where id=v_task.id returning * into v_task;
 return jsonb_build_object('id',v_task.id,'claim_token',v_task.claim_token);
end $$;

create or replace function public.finish_setter_task(p_task_id uuid,p_claim_token uuid,p_outcome text,p_notes text default null,p_callback_at timestamptz default null,p_appointment_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=private.setter_company(false); v_task public.tasks%rowtype; v_existing public.setter_call_outcomes%rowtype;
 v_id uuid; v_now timestamptz:=clock_timestamp(); v_next text;
begin
 perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
 select * into v_existing from public.setter_call_outcomes where task_id=p_task_id and company_id=v_company;
 if found and v_existing.user_id=auth.uid() and v_existing.claim_token=p_claim_token then
   if v_existing.outcome is distinct from p_outcome or v_existing.notes is distinct from nullif(btrim(p_notes),'')
      or v_existing.callback_at is distinct from p_callback_at or v_existing.appointment_id is distinct from p_appointment_id
   then raise exception 'Outcome already recorded; reload the queue' using errcode='40001'; end if;
   return v_existing.id;
 end if;
 select * into v_task from public.tasks where id=p_task_id and company_id=v_company for update;
 if not found or v_task.status<>'open' or v_task.claim_user_id is distinct from auth.uid() or v_task.claim_token is distinct from p_claim_token
 or v_task.claim_expires_at<=v_now or not private.setter_eligible(v_company,v_task.lead_id)
 then raise exception 'Claim expired or changed; reload the queue' using errcode='40001'; end if;
 if p_outcome is null or p_outcome not in ('booked_virtual','booked_in_home','callback_scheduled','no_answer','voicemail','not_interested','disqualified','handoff') or length(coalesce(p_notes,''))>2000
 then raise exception 'Choose a supported outcome' using errcode='22023'; end if;
 if p_outcome in ('disqualified','handoff') and length(btrim(coalesce(p_notes,'')))<3 then raise exception 'A reason is required' using errcode='22023'; end if;
 if p_outcome='callback_scheduled' and (p_callback_at is null or p_callback_at<=v_now or p_callback_at>v_now+interval '90 days')
 then raise exception 'Choose a future callback within 90 days' using errcode='22023'; end if;
 if p_outcome like 'booked_%' and not exists(select 1 from public.appointments a where a.id=p_appointment_id and a.company_id=v_company and a.lead_id=v_task.lead_id
 and a.status in ('scheduled','confirmed') and a.scheduled_at>v_now and (
   (p_outcome='booked_virtual' and a.meeting_type='virtual' and a.booking_link_id is not null)
   or (p_outcome='booked_in_home' and a.meeting_type='in_person')))
 then raise exception 'A real future appointment is required' using errcode='22023'; end if;
 if p_outcome<>'callback_scheduled' and p_callback_at is not null then raise exception 'Callback time does not match outcome' using errcode='22023'; end if;
 if p_outcome not like 'booked_%' and p_appointment_id is not null then raise exception 'Appointment does not match outcome' using errcode='22023'; end if;
 -- Handoff can be a non-call conversation review. All other outcomes are
 -- manual attestations, not telephony-provider confirmations.
 if p_outcome<>'handoff' then perform public.record_setter_attempt(p_task_id,p_claim_token); end if;
 insert into public.setter_call_outcomes(company_id,task_id,lead_id,user_id,claim_token,outcome,notes,callback_at,appointment_id)
 values(v_company,v_task.id,v_task.lead_id,auth.uid(),p_claim_token,p_outcome,nullif(btrim(p_notes),''),p_callback_at,p_appointment_id) returning id into v_id;
 update public.tasks set status=case when id=v_task.id then 'complete'::public.task_status else 'cancelled'::public.task_status end,
 completed_at=case when id=v_task.id then v_now end,claim_user_id=null,claim_token=null,claim_expires_at=null,updated_at=v_now
 where company_id=v_company and lead_id=v_task.lead_id and queue_bucket is not null and status='open';
 if p_outcome in ('not_interested','disqualified') then
   insert into public.setter_lead_stops(company_id,lead_id,reason,created_by) values(v_company,v_task.lead_id,p_outcome||coalesce(': '||nullif(btrim(p_notes),''),''),auth.uid()) on conflict do nothing;
 end if;
 v_next:=case when p_outcome='callback_scheduled' then 'scheduled_callback' when p_outcome in ('no_answer','voicemail') then 'follow_up' when p_outcome='handoff' then 'handoff' end;
 if v_next is not null then
   insert into public.tasks(company_id,lead_id,title,description,due_at,assigned_to,created_by,queue_bucket,parent_task_id,origin)
   values(v_company,v_task.lead_id,case v_next when 'scheduled_callback' then 'Scheduled homeowner callback' when 'handoff' then 'Setter handoff' else 'Follow up after unanswered call' end,
   nullif(btrim(p_notes),''),case v_next when 'scheduled_callback' then p_callback_at when 'handoff' then v_now else v_now+interval '2 hours' end,
   case when v_next='scheduled_callback' then auth.uid() end,auth.uid(),v_next,v_task.id,case when v_next='scheduled_callback' then 'callback_request' end);
 end if;
 return v_id;
end $$;

create or replace function public.get_setter_queue() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=public.current_member_company_id(); v_manager boolean:=public.has_company_role('manager');
 v_enabled boolean; v_setter boolean; v_task public.tasks%rowtype; v_current jsonb; v_buckets jsonb; v_members jsonb;
begin
 if auth.uid() is null or v_company is null then raise exception 'Queue access required' using errcode='42501'; end if;
 select coalesce((select enabled from public.setter_queue_settings where company_id=v_company),false) into v_enabled;
 select exists(select 1 from public.company_setters r join public.company_memberships m using(company_id,user_id)
 where r.company_id=v_company and r.user_id=auth.uid() and r.enabled and m.is_active) into v_setter;
 if not v_manager and not v_setter then raise exception 'Queue access required' using errcode='42501'; end if;
 if v_enabled and v_setter then
   select * into v_task from public.tasks where company_id=v_company and claim_user_id=auth.uid() and status='open' and claim_expires_at>clock_timestamp()
   and private.setter_eligible(company_id,lead_id);
   if found then
     select jsonb_build_object('id',v_task.id,'claim_token',v_task.claim_token,'title',v_task.title,'description',v_task.description,'due_at',v_task.due_at,
       'claim_expires_at',v_task.claim_expires_at,'attempted_at',v_task.attempted_at,'queue_bucket',v_task.queue_bucket,
       'current_claim_attempted',exists(select 1 from public.setter_call_attempts where task_id=v_task.id and claim_token=v_task.claim_token),
       'lead',jsonb_build_object('id',l.id,'name',l.name,'phone',coalesce(l.phone_e164,l.phone),'email',l.email,'address',l.submitted_address,'source',coalesce(l.original_lead_source,l.source_system),'stage',l.stage),
       'estimate',(select jsonb_build_object('roof_squares',e.roof_squares,'range_low_cents',e.range_low_cents,'range_high_cents',e.range_high_cents,'status',e.status) from public.roof_estimates e where e.company_id=v_company and e.lead_id=l.id order by e.created_at desc limit 1),
       'messages',coalesce((select jsonb_agg(to_jsonb(msg) order by msg.created_at) from (select direction,body,status,created_at from public.sms_messages where company_id=v_company and lead_id=l.id order by created_at desc limit 200) msg),'[]'::jsonb),
       'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.attempted_at desc) from (select attempted_at,user_id,channel from public.setter_call_attempts where company_id=v_company and lead_id=l.id order by attempted_at desc limit 100) a),'[]'::jsonb),
       'outcomes',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from (select outcome,notes,created_at,user_id from public.setter_call_outcomes where company_id=v_company and lead_id=l.id order by created_at desc limit 100) o),'[]'::jsonb),
       'appointments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'meeting_type',a.meeting_type,'scheduled_at',a.scheduled_at,'status',a.status,'reservable',a.booking_link_id is not null) order by a.scheduled_at) from public.appointments a where a.company_id=v_company and a.lead_id=l.id and a.status in ('scheduled','confirmed') and a.scheduled_at>clock_timestamp()),'[]'::jsonb)
     ) into v_current from public.leads l where l.id=v_task.lead_id and l.company_id=v_company;
   end if;
 end if;
 if v_enabled then
   select coalesce(jsonb_object_agg(bucket,n),'{}'::jsonb) into v_buckets from (
    select case when t.queue_bucket='new_lead' and l.created_at<=clock_timestamp()-interval '15 minutes' then 'follow_up' else t.queue_bucket end bucket,count(*) n
    from public.tasks t join public.leads l on l.id=t.lead_id and l.company_id=t.company_id
    where t.company_id=v_company and t.status='open' and t.queue_bucket is not null and coalesce(t.due_at,clock_timestamp())<=clock_timestamp()
    and private.setter_eligible(v_company,t.lead_id)
    and (private.setter_assignee_available(v_company,t.assigned_to) or t.sla_escalated_at is not null or (v_manager and not v_setter)
      or (t.claimed_at is not null and coalesce(t.claim_expires_at,'-infinity'::timestamptz)<=clock_timestamp()))
    and ((v_manager and not v_setter) or not exists(select 1 from public.tasks busy where busy.company_id=v_company and busy.lead_id=t.lead_id
      and busy.status='open' and busy.claim_user_id is not null and busy.claim_user_id<>auth.uid() and busy.claim_expires_at>clock_timestamp()))
    and (t.queue_bucket in ('call_request','scheduled_callback','handoff') or not exists(select 1 from public.appointments a where a.company_id=v_company and a.lead_id=t.lead_id and a.status in ('scheduled','confirmed') and a.scheduled_at>clock_timestamp()))
    group by 1) b;
 end if;
 if v_manager then
   select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',p.display_name,'role',m.role,'enabled',coalesce(r.enabled,false),'on_shift_until',r.on_shift_until) order by p.display_name),'[]'::jsonb)
   into v_members from public.company_memberships m join public.admin_profiles p on p.id=m.user_id left join public.company_setters r on r.company_id=m.company_id and r.user_id=m.user_id
   where m.company_id=v_company and m.is_active;
 end if;
 return jsonb_build_object('enabled',v_enabled,'is_manager',v_manager,'is_setter',v_setter,'timezone',coalesce((select timezone from public.setter_queue_settings where company_id=v_company),'America/New_York'),
 'on_shift_until',(select on_shift_until from public.company_setters where company_id=v_company and user_id=auth.uid() and on_shift_until>clock_timestamp()),'current',v_current,'buckets',coalesce(v_buckets,'{}'::jsonb),'members',coalesce(v_members,'[]'::jsonb));
end $$;

-- Unify homeowner and setter callback promises under the queue lock.
create or replace function public.request_estimate_callback(
  p_public_token uuid,
  p_call_window text,
  p_due_at timestamptz
) returns table (task_id uuid, call_window text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate record;
  v_task public.tasks%rowtype;
  v_window text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_call_window, '')));
  v_label text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_label := case v_window
    when 'asap' then 'as soon as possible'
    when 'morning' then 'in the morning (9 to 12)'
    when 'afternoon' then 'in the afternoon (12 to 5)'
    when 'evening' then 'in the early evening (5 to 8)'
  end;
  if v_label is null then
    raise exception 'Unsupported call window';
  end if;
  if p_due_at is null then
    raise exception 'A due time is required';
  end if;

  select estimate.company_id, estimate.lead_id into v_estimate
  from public.roof_estimates estimate
  where estimate.public_token = p_public_token;
  if not found or v_estimate.lead_id is null then
    raise exception 'Estimate not found';
  end if;

  -- Match the queue writer's lock order before locking a task row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('setter-company:' || v_estimate.company_id::text, 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estimate-callback:' || v_estimate.lead_id::text, 0)
  );

  select task.* into v_task
  from public.tasks task
  where task.lead_id = v_estimate.lead_id
    and task.company_id = v_estimate.company_id
    and task.origin = 'callback_request'
    and task.status = 'open'
  for update;

  -- The homeowner's latest callback promise supersedes other open queue
  -- work, including a currently claimed intake/follow-up call. An old
  -- outcome must not cancel or overwrite that promise.
  update public.tasks task set status = 'cancelled',
    claim_user_id = null, claim_token = null, claim_expires_at = null,
    claimed_at = null, updated_at = v_now
  where task.company_id = v_estimate.company_id
    and task.lead_id = v_estimate.lead_id
    and task.queue_bucket is not null and task.status = 'open'
    and task.id is distinct from v_task.id;

  if v_task.id is not null then
    update public.tasks task set
      description = 'The homeowner asked for a call ' || v_label || ', Eastern time.',
      due_at = p_due_at,
      updated_at = v_now
    where task.id = v_task.id
    returning task.* into v_task;
    return query select v_task.id, v_window, false;
    return;
  end if;

  insert into public.tasks(company_id, lead_id, title, description, due_at, origin, created_at, updated_at)
  values (
    v_estimate.company_id,
    v_estimate.lead_id,
    'Call back: homeowner asked for a call',
    'The homeowner asked for a call ' || v_label || ', Eastern time.',
    p_due_at,
    'callback_request',
    v_now,
    v_now
  )
  returning * into v_task;

  insert into public.notifications(company_id, lead_id, type, title, body, correlation_id, created_at)
  values (
    v_estimate.company_id,
    v_estimate.lead_id,
    'callback_requested',
    'Callback requested',
    'A homeowner asked for a call ' || v_label || '.',
    v_task.id,
    v_now
  )
  on conflict do nothing;

  return query select v_task.id, v_window, true;
end;
$$;

revoke execute on function public.request_estimate_callback(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.request_estimate_callback(uuid, text, timestamptz) to service_role;
