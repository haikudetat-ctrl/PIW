-- A separate enrollment grants the setter workflow, never the full CRM.
create table public.setter_queue_settings (
 company_id uuid primary key references public.companies(id) on delete cascade,
 enabled boolean not null default false,
 timezone text not null default 'America/New_York'
);
create table public.company_setters (
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references public.admin_profiles(id) on delete cascade,
 enabled boolean not null default true,
 on_shift_until timestamptz,
 primary key(company_id,user_id),
 foreign key(user_id,company_id) references public.company_memberships(user_id,company_id)
);
create table public.setter_lead_stops (
 company_id uuid not null references public.companies(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 reason text not null,
 created_by uuid not null references public.admin_profiles(id),
 created_at timestamptz not null default now(),
 primary key(company_id,lead_id)
);
alter table public.tasks
 add column queue_bucket text check(queue_bucket in ('call_request','scheduled_callback','new_lead','handoff','follow_up')),
 add column queue_revision uuid not null default gen_random_uuid(),
 add column claim_user_id uuid references public.admin_profiles(id),
 add column claim_token uuid,
 add column claimed_at timestamptz,
 add column claim_expires_at timestamptz,
 add column attempted_at timestamptz,
 add column sla_escalated_at timestamptz,
 add column sla_missed_at timestamptz,
 add column parent_task_id uuid references public.tasks(id) on delete set null,
 add constraint setter_claim_shape check (
   (claim_user_id is null and claim_token is null and claim_expires_at is null)
   or (queue_bucket is not null and claim_user_id is not null and claim_token is not null and claim_expires_at is not null)
 );
create index tasks_setter_queue_idx on public.tasks(company_id,due_at) where status='open' and queue_bucket is not null;
create unique index tasks_setter_one_claim_idx on public.tasks(claim_user_id) where status='open' and claim_user_id is not null;
create unique index tasks_setter_one_lead_claim_idx on public.tasks(company_id,lead_id) where status='open' and claim_user_id is not null;
create unique index tasks_setter_one_child_idx on public.tasks(parent_task_id) where parent_task_id is not null and queue_bucket is not null;

create table public.setter_call_attempts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 user_id uuid not null references public.admin_profiles(id),
 claim_token uuid not null,
 attempted_at timestamptz not null default clock_timestamp(),
 channel text not null default 'manual_call' check(channel='manual_call'),
 unique(task_id,claim_token)
);
create table public.setter_call_outcomes (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 task_id uuid not null unique references public.tasks(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 user_id uuid not null references public.admin_profiles(id),
 claim_token uuid not null,
 outcome text not null check(outcome in ('booked_virtual','booked_in_home','callback_scheduled','no_answer','voicemail','not_interested','disqualified','handoff')),
 notes text,
 callback_at timestamptz,
 appointment_id uuid references public.appointments(id),
 created_at timestamptz not null default clock_timestamp()
);

alter table public.setter_queue_settings enable row level security;
alter table public.company_setters enable row level security;
alter table public.setter_lead_stops enable row level security;
alter table public.setter_call_attempts enable row level security;
alter table public.setter_call_outcomes enable row level security;
revoke all on public.setter_queue_settings,public.company_setters,public.setter_lead_stops,public.setter_call_attempts,public.setter_call_outcomes from anon,authenticated;
grant all on public.setter_queue_settings,public.company_setters,public.setter_lead_stops,public.setter_call_attempts,public.setter_call_outcomes to service_role;
grant select on public.setter_queue_settings,public.company_setters,public.setter_lead_stops,public.setter_call_attempts,public.setter_call_outcomes to authenticated;
create policy "manager setter settings" on public.setter_queue_settings for select to authenticated using(company_id=(select public.current_company_id()));
create policy "manager setter roster" on public.company_setters for select to authenticated using(company_id=(select public.current_company_id()));
create policy "manager setter stops" on public.setter_lead_stops for select to authenticated using(company_id=(select public.current_company_id()));
create policy "manager setter attempts" on public.setter_call_attempts for select to authenticated using(company_id=(select public.current_company_id()));
create policy "manager setter outcomes" on public.setter_call_outcomes for select to authenticated using(company_id=(select public.current_company_id()));

create function private.setter_eligible(p_company uuid,p_lead uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.leads l where l.id=p_lead and l.company_id=p_company and not l.is_test and l.stage not in ('won','lost')
 and not exists(select 1 from public.setter_lead_stops s where s.company_id=p_company and s.lead_id=l.id)
 and not exists(select 1 from public.booking_contact_ownership o where o.company_id=p_company and o.contact_owner='external'
   and (o.lead_id=l.id or o.phone_e164=coalesce(l.phone_e164,case
      when length(regexp_replace(l.phone,'[^0-9]','','g'))=10 then '+1'||regexp_replace(l.phone,'[^0-9]','','g')
      else '+'||regexp_replace(l.phone,'[^0-9]','','g') end))))
$$;

create function private.setter_company(p_shift boolean default false) returns uuid
language plpgsql stable set search_path='' as $$
declare v_company uuid:=public.current_member_company_id();
begin
 if auth.uid() is null or v_company is null or not exists(
   select 1 from public.company_setters r join public.setter_queue_settings s using(company_id)
   join public.company_memberships m on m.company_id=r.company_id and m.user_id=r.user_id and m.is_active
   where r.company_id=v_company and r.user_id=auth.uid() and r.enabled and s.enabled
 ) then raise exception 'Queue access required' using errcode='42501'; end if;
 if p_shift and not exists(select 1 from public.company_setters where company_id=v_company and user_id=auth.uid() and on_shift_until>clock_timestamp())
 then raise exception 'Go on shift before claiming a lead' using errcode='42501'; end if;
 return v_company;
end $$;

create function private.setter_task_bucket(p_origin text,p_title text,p_due timestamptz) returns text
language sql stable set search_path='' as $$
 select case when p_origin='callback_request' then case when p_due>clock_timestamp() then 'scheduled_callback' else 'call_request' end
 when p_title in ('Contact new virtual inspection lead','Contact new in-home inspection lead','Call new roof-estimate lead now') then 'new_lead' end
$$;

create function private.setter_assignee_available(p_company uuid,p_assignee uuid) returns boolean
language sql stable set search_path='' as $$
 select p_assignee is null or p_assignee=auth.uid() or not exists(
   select 1 from public.company_setters r join public.company_memberships m using(company_id,user_id)
   where r.company_id=p_company and r.user_id=p_assignee and r.enabled and m.is_active)
$$;

create function private.classify_setter_task() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.queue_bucket is null and new.status='open'
   and exists(select 1 from public.setter_queue_settings where company_id=new.company_id and enabled)
   and private.setter_eligible(new.company_id,new.lead_id) then
   new.queue_bucket:=private.setter_task_bucket(new.origin,new.title,new.due_at);
 end if;
 if tg_op='UPDATE' and old.queue_bucket is not null and old.origin='callback_request'
   and new.status='open' and new.due_at is distinct from old.due_at then
   new.queue_bucket:=private.setter_task_bucket(new.origin,new.title,new.due_at);
   new.queue_revision:=gen_random_uuid();
   new.claim_user_id:=null; new.claim_token:=null; new.claim_expires_at:=null; new.claimed_at:=null;
   new.attempted_at:=null; new.sla_escalated_at:=null; new.sla_missed_at:=null;
 end if;
 return new;
end $$;
-- This runs as the writer. Ordinary authenticated task updates cannot bypass
-- dispositions by clearing metadata, cancelling or deleting the task.
create function private.guard_setter_task() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and (
   (tg_op<>'INSERT' and old.queue_bucket is not null) or (tg_op<>'DELETE' and new.queue_bucket is not null)
 ) then raise exception 'Use the setter queue to change queued tasks' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger a_setter_classify before insert or update on public.tasks for each row execute function private.classify_setter_task();
create trigger z_setter_guard before insert or update or delete on public.tasks for each row execute function private.guard_setter_task();

create function public.save_setter_queue_settings(p_enabled boolean,p_timezone text) returns void
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=public.current_company_id();
begin
 if auth.uid() is null or v_company is null then raise exception 'Manager access required' using errcode='42501'; end if;
 if p_enabled is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
 raise exception 'Choose a valid company time zone' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
 insert into public.setter_queue_settings(company_id,enabled,timezone) values(v_company,p_enabled,p_timezone)
 on conflict(company_id) do update set enabled=excluded.enabled,timezone=excluded.timezone;
 if p_enabled then
   update public.tasks t set queue_bucket=private.setter_task_bucket(t.origin,t.title,t.due_at)
   where t.company_id=v_company and t.status='open' and t.queue_bucket is null and private.setter_eligible(t.company_id,t.lead_id)
     and private.setter_task_bucket(t.origin,t.title,t.due_at) is not null;
 end if;
end $$;

create function public.set_company_setter(p_user_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=public.current_company_id();
begin
 if auth.uid() is null or v_company is null then raise exception 'Manager access required' using errcode='42501'; end if;
 if p_enabled is null or not exists(select 1 from public.company_memberships where user_id=p_user_id and company_id=v_company and is_active)
 then raise exception 'Active company member required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
 insert into public.company_setters(company_id,user_id,enabled) values(v_company,p_user_id,p_enabled)
 on conflict(company_id,user_id) do update set enabled=excluded.enabled,on_shift_until=case when excluded.enabled then public.company_setters.on_shift_until else null end;
 if not p_enabled then
   update public.tasks set claim_user_id=null,claim_token=null,claim_expires_at=null,claimed_at=null
   where company_id=v_company and claim_user_id=p_user_id and status='open';
 end if;
end $$;

create function public.set_setter_shift(p_on_shift boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=private.setter_company(false);
begin
 perform pg_advisory_xact_lock(hashtextextended('setter-user:'||auth.uid()::text,0));
 perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
 if p_on_shift is null then raise exception 'Choose a shift state' using errcode='22023'; end if;
 if not p_on_shift and exists(select 1 from public.tasks where claim_user_id=auth.uid() and status='open' and claim_expires_at>clock_timestamp())
 then raise exception 'Record an outcome before going off shift' using errcode='22023'; end if;
 update public.company_setters set on_shift_until=case when p_on_shift then clock_timestamp()+interval '8 hours' end
 where company_id=v_company and user_id=auth.uid();
end $$;

create function public.claim_setter_task(p_task_id uuid default null) returns jsonb
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

create function public.record_setter_attempt(p_task_id uuid,p_claim_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=private.setter_company(false); v_task public.tasks%rowtype; v_now timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
 select * into v_task from public.tasks where id=p_task_id and company_id=v_company for update;
 if not found or v_task.status<>'open' or v_task.claim_user_id is distinct from auth.uid() or v_task.claim_token is distinct from p_claim_token
 or v_task.claim_expires_at<=v_now or not private.setter_eligible(v_company,v_task.lead_id)
 then raise exception 'Claim expired or changed; reload the queue' using errcode='40001'; end if;
 insert into public.setter_call_attempts(company_id,task_id,lead_id,user_id,claim_token,attempted_at)
 values(v_company,v_task.id,v_task.lead_id,auth.uid(),p_claim_token,v_now) on conflict(task_id,claim_token) do nothing;
 update public.tasks set attempted_at=coalesce(attempted_at,v_now),claim_expires_at=v_now+interval '15 minutes' where id=v_task.id;
 update public.leads set first_contact_attempted_at=coalesce(first_contact_attempted_at,v_now),first_contact_channel=coalesce(first_contact_channel,'call') where id=v_task.lead_id and company_id=v_company;
end $$;

create function public.finish_setter_task(p_task_id uuid,p_claim_token uuid,p_outcome text,p_notes text default null,p_callback_at timestamptz default null,p_appointment_id uuid default null) returns uuid
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

-- The only employee-visible lead context is their current, unexpired claim.
create function public.get_setter_queue() returns jsonb
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

revoke all on function private.setter_eligible(uuid,uuid),private.setter_company(boolean),private.setter_task_bucket(text,text,timestamptz),private.classify_setter_task(),private.guard_setter_task() from public,anon,authenticated;
revoke all on function private.setter_assignee_available(uuid,uuid) from public,anon,authenticated;
grant execute on function private.setter_eligible(uuid,uuid) to service_role;
revoke all on function public.save_setter_queue_settings(boolean,text),public.set_company_setter(uuid,boolean),public.set_setter_shift(boolean),public.claim_setter_task(uuid),public.record_setter_attempt(uuid,uuid),public.finish_setter_task(uuid,uuid,text,text,timestamptz,uuid),public.get_setter_queue() from public,anon;
grant execute on function public.save_setter_queue_settings(boolean,text),public.set_company_setter(uuid,boolean),public.set_setter_shift(boolean),public.claim_setter_task(uuid),public.record_setter_attempt(uuid,uuid),public.finish_setter_task(uuid,uuid,text,text,timestamptz,uuid),public.get_setter_queue() to authenticated;
