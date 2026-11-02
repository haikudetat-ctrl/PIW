-- Approved text intent lives in PIW. No company or template starts enabled.
create table public.sms_template_versions (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 kind text not null check(kind in ('first_touch','missed_call','booking_confirmation','booking_rescheduled','reminder_day','reminder_hour')),
 version integer not null check(version>0),body text not null check(length(body) between 1 and 1200),
 status text not null default 'draft' check(status in ('draft','approved','retired')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 approved_by uuid references auth.users(id),approved_at timestamptz,
 unique(company_id,kind,version),unique(company_id,id),
 check((status='draft' and approved_by is null and approved_at is null) or (status<>'draft' and approved_by is not null and approved_at is not null))
);
create unique index sms_one_approved_kind on public.sms_template_versions(company_id,kind) where status='approved';
create table public.sms_automation_settings (
 company_id uuid primary key references public.companies(id) on delete cascade,
 enabled boolean not null default false,timezone text not null default 'America/New_York',
 updated_by uuid references auth.users(id),updated_at timestamptz not null default clock_timestamp()
);
create table public.sms_phone_pauses (
 company_id uuid not null references public.companies(id) on delete cascade,
 phone_e164 text not null check(phone_e164~'^\+1[2-9][0-9]{9}$'),paused boolean not null,
 reason text not null,updated_by uuid references auth.users(id),updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,phone_e164)
);
create table public.sms_delivery_jobs (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 source text not null check(source in ('manual','automatic')),
 kind text not null check(kind in ('first_touch','missed_call','booking_confirmation','booking_rescheduled','reminder_day','reminder_hour')),
 appointment_id uuid references public.appointments(id) on delete cascade,appointment_revision bigint,
 task_id uuid references public.tasks(id) on delete set null,task_claim_token uuid,actor_id uuid references auth.users(id) on delete set null,
 requested_template_id uuid references public.sms_template_versions(id),template_version_id uuid references public.sms_template_versions(id),
 status text not null default 'queued' check(status in ('queued','preparing','sending','accepted','failed','unknown','skipped')),
 not_before timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 attempt_token uuid,preparing_until timestamptz,started_at timestamptz,
 message_id uuid references public.sms_messages(id) on delete set null,
 reason text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((source='manual' and appointment_id is null and appointment_revision is null and task_claim_token is not null and requested_template_id is not null)
   or (source='automatic' and appointment_id is not null and appointment_revision>0 and task_claim_token is null and requested_template_id is null)),
 check(expires_at>not_before)
);
create unique index sms_one_manual_intent_per_claim on public.sms_delivery_jobs(company_id,task_id,task_claim_token) where source='manual';
create unique index sms_one_appointment_intent on public.sms_delivery_jobs(appointment_id,appointment_revision,kind) where source='automatic';
create index sms_jobs_due on public.sms_delivery_jobs(company_id,not_before) where status in ('queued','preparing');
create index sms_jobs_unresolved on public.sms_delivery_jobs(company_id,lead_id) where status in ('sending','unknown');
alter table public.sms_messages add column approved_delivery_id uuid references public.sms_delivery_jobs(id) on delete set null;
create unique index sms_one_message_per_delivery on public.sms_messages(approved_delivery_id) where approved_delivery_id is not null;
alter table public.sms_messages drop constraint sms_messages_status_check;
alter table public.sms_messages add constraint sms_messages_status_check check(status in ('sending','unknown','queued','sent','delivered','undelivered','failed','received'));
alter table public.tasks drop constraint tasks_origin_check;
alter table public.tasks add constraint tasks_origin_check check(origin in ('callback_request','sms_reply'));
create unique index tasks_one_sms_reply_review on public.tasks(company_id,lead_id) where origin='sms_reply' and status='open';

alter table public.sms_template_versions enable row level security;
alter table public.sms_automation_settings enable row level security;
alter table public.sms_phone_pauses enable row level security;
alter table public.sms_delivery_jobs enable row level security;
revoke all on public.sms_template_versions,public.sms_automation_settings,public.sms_phone_pauses,public.sms_delivery_jobs from public,anon,authenticated;
grant all on public.sms_template_versions,public.sms_automation_settings,public.sms_phone_pauses,public.sms_delivery_jobs to service_role;
grant select on public.sms_template_versions,public.sms_automation_settings,public.sms_phone_pauses,public.sms_delivery_jobs to authenticated;
create policy "admins read approved templates" on public.sms_template_versions for select to authenticated using(company_id=(select public.current_member_company_id()) and (select public.has_company_role('company_admin')));
create policy "admins read sms automation" on public.sms_automation_settings for select to authenticated using(company_id=(select public.current_member_company_id()) and (select public.has_company_role('company_admin')));
create policy "admins read sms pauses" on public.sms_phone_pauses for select to authenticated using(company_id=(select public.current_member_company_id()) and (select public.has_company_role('company_admin')));
create policy "admins read sms deliveries" on public.sms_delivery_jobs for select to authenticated using(company_id=(select public.current_member_company_id()) and (select public.has_company_role('company_admin')));

create function private.sms_admin_company() returns uuid language plpgsql stable set search_path='' as $$
declare c uuid:=public.current_member_company_id(); begin
 if auth.uid() is null or c is null or not public.has_company_role('company_admin') then raise exception 'Company admin access required' using errcode='42501'; end if;
 return c;
end $$;
create function private.sms_us_phone(p_phone text) returns text language sql immutable set search_path='' as $$
 select case when p_phone~'^\+1[2-9][0-9]{9}$' then p_phone
 when regexp_replace(p_phone,'[^0-9]','','g')~'^[2-9][0-9]{9}$' then '+1'||regexp_replace(p_phone,'[^0-9]','','g')
 when regexp_replace(p_phone,'[^0-9]','','g')~'^1[2-9][0-9]{9}$' then '+'||regexp_replace(p_phone,'[^0-9]','','g') end
$$;
create function private.next_sms_open(p_now timestamptz,p_timezone text,p_start integer,p_end integer) returns timestamptz
language plpgsql stable set search_path='' as $$
declare local_time timestamp:=p_now at time zone p_timezone; h integer:=extract(hour from local_time); d date:=local_time::date;
begin
 if p_start=p_end or not(case when p_start>p_end then h>=p_start or h<p_end else h>=p_start and h<p_end end) then return p_now; end if;
 if p_start>p_end and h>=p_start then d:=d+1; end if;
 return (d+make_time(p_end,0,0)) at time zone p_timezone;
end $$;
create function private.sms_status_rank(p_status text) returns integer language sql immutable set search_path='' as $$
 select case p_status when 'unknown' then 0 when 'sending' then 0 when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3 when 'undelivered' then 4 when 'failed' then 4 else -1 end
$$;
create function private.validate_sms_template(p_kind text,p_body text) returns void language plpgsql set search_path='' as $$
declare field text[];
begin
 if p_kind is null or p_kind not in ('first_touch','missed_call','booking_confirmation','booking_rescheduled','reminder_day','reminder_hour')
 or length(btrim(coalesce(p_body,''))) not between 1 and 1200 or position('{company_name}' in p_body)=0 or p_body!~*'\mSTOP\M'
 or regexp_replace(p_body,'\{[a-z_]+\}','','g')~'[{}]'
 then raise exception 'Check template fields, company identity and STOP wording' using errcode='22023'; end if;
 for field in select regexp_matches(p_body,'\{([a-z_]+)\}','g') loop
   if field[1] not in ('first_name','company_name') and (p_kind in ('first_touch','missed_call') or field[1] not in ('booking_time','booking_link')) then
     raise exception 'Check template fields, company identity and STOP wording' using errcode='22023';
   end if;
 end loop;
 if p_kind not in ('first_touch','missed_call') and (position('{booking_time}' in p_body)=0 or position('{booking_link}' in p_body)=0) then
   raise exception 'Appointment templates need booking time and manage link' using errcode='22023';
 end if;
end $$;
create function private.guard_sms_template_version() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.company_id,new.kind,new.version,new.body,new.created_by,new.created_at) is distinct from (old.id,old.company_id,old.kind,old.version,old.body,old.created_by,old.created_at)
 or not((old.status='draft' and new.status='approved' and new.approved_by is not null and new.approved_at is not null)
   or (old.status='approved' and new.status='retired' and (new.approved_by,new.approved_at) is not distinct from (old.approved_by,old.approved_at)))
 then raise exception 'Template versions are immutable' using errcode='22023'; end if;
 return new;
end $$;
create trigger sms_template_immutable before update on public.sms_template_versions for each row execute function private.guard_sms_template_version();

create function public.save_sms_template_draft(p_kind text,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); v_id uuid; begin
 perform private.validate_sms_template(p_kind,p_body);
 perform pg_advisory_xact_lock(hashtextextended('sms-template:'||c::text,0));
 insert into public.sms_template_versions(company_id,kind,version,body,created_by)
 select c,p_kind,coalesce(max(version),0)+1,btrim(p_body),auth.uid() from public.sms_template_versions where company_id=c and kind=p_kind returning id into v_id;
 return v_id;
end $$;
create function public.approve_sms_template(p_template_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); t public.sms_template_versions%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('sms-template:'||c::text,0));
 select * into t from public.sms_template_versions where id=p_template_id and company_id=c for update;
 if not found then raise exception 'Template access required' using errcode='42501'; end if;
 if t.status<>'draft' then raise exception 'Create a new draft before approval' using errcode='22023'; end if;
 perform private.validate_sms_template(t.kind,t.body);
 update public.sms_template_versions set status='retired' where company_id=c and kind=t.kind and status='approved';
 update public.sms_template_versions set status='approved',approved_by=auth.uid(),approved_at=clock_timestamp() where id=t.id;
 insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,metadata) values(c,auth.uid(),'sms_template_approved','sms_template',t.id,jsonb_build_object('kind',t.kind,'version',t.version));
end $$;
create function public.retire_sms_template(p_template_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); begin
 perform pg_advisory_xact_lock(hashtextextended('sms-template:'||c::text,0));
 if not exists(select 1 from public.sms_template_versions where id=p_template_id and company_id=c and status='approved') then raise exception 'Template access required' using errcode='42501'; end if;
 update public.sms_template_versions set status='retired' where id=p_template_id and company_id=c;
 insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id) values(c,auth.uid(),'sms_template_retired','sms_template',p_template_id);
end $$;
create function public.save_sms_automation_settings(p_enabled boolean,p_timezone text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); begin
 if p_enabled is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid texting timezone' using errcode='22023'; end if;
 if p_enabled and ((select count(*) from public.sms_template_versions where company_id=c and status='approved' and kind in ('booking_confirmation','booking_rescheduled','reminder_day','reminder_hour'))<>4
 or not exists(select 1 from public.company_sms_settings where company_id=c and enabled)) then raise exception 'Approve all appointment templates and configure the sender first' using errcode='22023'; end if;
 insert into public.sms_automation_settings(company_id,enabled,timezone,updated_by) values(c,p_enabled,p_timezone,auth.uid())
 on conflict(company_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,metadata) values(c,auth.uid(),'sms_automation_settings','company',c,jsonb_build_object('enabled',p_enabled,'timezone',p_timezone));
end $$;

create function public.get_setter_texting_context(p_task_id uuid,p_claim_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.setter_company(false); t public.tasks%rowtype; phone text; begin
 t:=private.lock_setter_booking_claim(c,auth.uid(),p_task_id,p_claim_token);
 select private.sms_us_phone(coalesce(l.phone_e164,l.phone)) into phone from public.leads l where l.company_id=c and l.id=t.lead_id;
 return jsonb_build_object('company_id',c,'phone',phone,'paused',coalesce((select paused from public.sms_phone_pauses where company_id=c and phone_e164=phone),false),
 'templates',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'version',version,'body',body) order by kind) from public.sms_template_versions where company_id=c and status='approved' and kind in ('first_touch','missed_call')),'[]'::jsonb),
 'company_name',(select name from public.companies where id=c),
 'delivery',(select jsonb_build_object('id',j.id,'status',j.status,'reason',j.reason,'template_id',j.requested_template_id) from public.sms_delivery_jobs j where company_id=c and task_id=t.id and task_claim_token=p_claim_token and source='manual'));
end $$;
create function public.queue_setter_template_sms(p_task_id uuid,p_claim_token uuid,p_template_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid:=private.setter_company(false); t public.tasks%rowtype; j public.sms_delivery_jobs%rowtype; v_id uuid; begin
 t:=private.lock_setter_booking_claim(c,auth.uid(),p_task_id,p_claim_token);
 if not exists(select 1 from public.sms_template_versions where id=p_template_id and company_id=c and status='approved' and kind in ('first_touch','missed_call')) then raise exception 'Choose an approved template' using errcode='22023'; end if;
 select * into j from public.sms_delivery_jobs where company_id=c and task_id=t.id and task_claim_token=p_claim_token and source='manual';
 if found then
   if j.requested_template_id<>p_template_id then raise exception 'A text is already recorded for this claim' using errcode='22023'; end if;
   return j.id;
 end if;
 insert into public.sms_delivery_jobs(company_id,lead_id,source,kind,task_id,task_claim_token,actor_id,requested_template_id,expires_at)
 select c,t.lead_id,'manual',kind,t.id,p_claim_token,auth.uid(),id,clock_timestamp()+interval '15 minutes' from public.sms_template_versions where id=p_template_id returning id into v_id;
 return v_id;
end $$;
create function private.write_sms_pause(p_company uuid,p_phone text,p_paused boolean,p_actor uuid,p_reason text) returns void language plpgsql set search_path='' as $$
begin
 if p_phone is null or p_paused is null then raise exception 'A textable phone is required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sms-phone:'||p_company::text||':'||p_phone,0));
 insert into public.sms_phone_pauses(company_id,phone_e164,paused,reason,updated_by) values(p_company,p_phone,p_paused,p_reason,p_actor)
 on conflict(company_id,phone_e164) do update set paused=excluded.paused,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=clock_timestamp();
end $$;
create function public.set_setter_sms_pause(p_task_id uuid,p_claim_token uuid,p_paused boolean) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.setter_company(false); t public.tasks%rowtype; phone text; begin
 t:=private.lock_setter_booking_claim(c,auth.uid(),p_task_id,p_claim_token);
 select private.sms_us_phone(coalesce(phone_e164,l.phone)) into phone from public.leads l where l.id=t.lead_id and l.company_id=c;
 perform private.write_sms_pause(c,phone,p_paused,auth.uid(),'setter');
 insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,metadata) values(c,auth.uid(),'sms_pause_changed','lead',t.lead_id,jsonb_build_object('paused',p_paused));
end $$;
create function public.set_company_sms_pause(p_phone_e164 text,p_paused boolean) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); begin
 if not exists(select 1 from public.leads where company_id=c and private.sms_us_phone(coalesce(phone_e164,phone))=p_phone_e164) then raise exception 'Lead access required' using errcode='42501'; end if;
 perform private.write_sms_pause(c,p_phone_e164,p_paused,auth.uid(),'company_admin');
 insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,metadata) values(c,auth.uid(),'sms_pause_changed','company',c,jsonb_build_object('phone',p_phone_e164,'paused',p_paused));
end $$;

-- Preparing is safe to reclaim. Sending is never safe to repeat automatically.
create function public.claim_approved_sms_delivery(p_company_id uuid,p_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.sms_delivery_jobs%rowtype; t public.sms_template_versions%rowtype; l public.leads%rowtype;
 s public.company_sms_settings%rowtype; a public.appointments%rowtype; tz text;
begin
 select * into j from public.sms_delivery_jobs where company_id=p_company_id and (p_id is null or id=p_id)
 and not_before<=clock_timestamp() and expires_at>clock_timestamp()
 and (status='queued' or (status='preparing' and preparing_until<=clock_timestamp()))
 order by not_before,id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into t from public.sms_template_versions where company_id=j.company_id and kind=j.kind and status='approved'
 and (j.source='automatic' or id=j.requested_template_id);
 update public.sms_delivery_jobs set status='preparing',attempt_token=gen_random_uuid(),preparing_until=clock_timestamp()+interval '1 minute',
 template_version_id=t.id,reason=null,updated_at=clock_timestamp() where id=j.id returning * into j;
 select * into l from public.leads where id=j.lead_id and company_id=j.company_id;
 select * into s from public.company_sms_settings where company_id=j.company_id;
 select * into a from public.appointments where id=j.appointment_id and company_id=j.company_id and lead_id=j.lead_id;
 select coalesce((select timezone from public.sms_automation_settings where company_id=j.company_id),'America/New_York') into tz;
 return jsonb_build_object('id',j.id,'company_id',j.company_id,'lead_id',j.lead_id,'source',j.source,'kind',j.kind,'attempt_token',j.attempt_token,
 'template',case when t.id is not null then jsonb_build_object('id',t.id,'body',t.body,'version',t.version) end,
 'first_name',coalesce(nullif(split_part(btrim(l.name),' ',1),''),'there'),'company_name',(select name from public.companies where id=j.company_id),
 'to_e164',private.sms_us_phone(coalesce(l.phone_e164,l.phone)),'from_e164',s.from_e164,'messaging_service_sid',s.messaging_service_sid,
 'booking_link_id',a.booking_link_id,'scheduled_at',a.scheduled_at,'timezone',coalesce((select timezone from public.booking_settings where company_id=j.company_id),tz));
end $$;

create function private.sms_delivery_block_reason(j public.sms_delivery_jobs) returns text language plpgsql set search_path='' as $$
declare l public.leads%rowtype; phone text;
begin
 select * into l from public.leads where id=j.lead_id and company_id=j.company_id;
 if not found or not private.setter_eligible(j.company_id,j.lead_id) then return 'lead_ineligible'; end if;
 phone:=private.sms_us_phone(coalesce(l.phone_e164,l.phone));
 if phone is null then return 'no_phone'; end if;
 if not exists(select 1 from public.company_sms_settings where company_id=j.company_id and enabled) then return 'sender_disabled'; end if;
 if not exists(select 1 from public.lead_consents where company_id=j.company_id and lead_id=j.lead_id and consent_type='sms_contact' and granted) then return 'no_consent'; end if;
 if public.is_suppressed(j.company_id,'sms',phone,null) then return 'suppressed'; end if;
 if j.source='automatic' then
   if not exists(select 1 from public.sms_automation_settings where company_id=j.company_id and enabled) then return 'automation_paused'; end if;
   if exists(select 1 from public.sms_phone_pauses where company_id=j.company_id and phone_e164=phone and paused) then return 'reply_or_manual_pause'; end if;
   if not exists(select 1 from public.appointments where id=j.appointment_id and company_id=j.company_id and lead_id=j.lead_id
      and revision=j.appointment_revision and status in ('scheduled','confirmed') and meeting_type='virtual' and scheduled_at>clock_timestamp()) then return 'stale_appointment'; end if;
 end if;
 if exists(select 1 from public.sms_delivery_jobs other join public.sms_messages m on m.id=other.message_id
   where other.company_id=j.company_id and other.id<>j.id and other.status in ('sending','unknown') and m.to_e164=phone) then return 'delivery_unresolved'; end if;
 return null;
end $$;

create function public.start_approved_sms_delivery(p_id uuid,p_token uuid,p_template_id uuid,p_body text,p_to text,p_from text,p_service_sid text,p_segments integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.sms_delivery_jobs%rowtype; s public.company_sms_settings%rowtype; phone text; live_phone text; v_reason text;
 v_open timestamptz; tz text; m_id uuid; v_now timestamptz;
begin
 -- Universal order: manual setter-company/task OR automatic appointment,
 -- then phone, then job. Booking triggers hold appointment before job rows.
 -- Never take a job lock and then wait for its appointment or setter claim.
 select * into j from public.sms_delivery_jobs where id=p_id;
 if not found then return jsonb_build_object('started',false,'reason','missing'); end if;
 if j.source='manual' then
   begin perform private.lock_setter_booking_claim(j.company_id,j.actor_id,j.task_id,j.task_claim_token);
   exception when sqlstate '40001' or sqlstate '42501' then v_reason:='claim_changed'; end;
 else
   perform 1 from public.appointments where id=j.appointment_id and company_id=j.company_id for share;
 end if;
 select private.sms_us_phone(coalesce(l.phone_e164,l.phone)) into phone from public.leads l where id=j.lead_id and company_id=j.company_id;
 perform pg_advisory_xact_lock(hashtextextended('sms-phone:'||j.company_id::text||':'||coalesce(phone,''),0));
 select * into j from public.sms_delivery_jobs where id=p_id for update;
 select private.sms_us_phone(coalesce(l.phone_e164,l.phone)) into live_phone from public.leads l where id=j.lead_id and company_id=j.company_id;
 v_now:=clock_timestamp();
 if j.status<>'preparing' or j.attempt_token is distinct from p_token or j.preparing_until<=v_now then return jsonb_build_object('started',false,'reason','not_claimed'); end if;
 v_reason:=coalesce(v_reason,case when j.expires_at<=v_now then 'expired' end,private.sms_delivery_block_reason(j));
 -- Hold the approved version through dispatch preparation. A retired version
 -- cannot slip through because it was read before an approval change.
 perform 1 from public.sms_template_versions where id=p_template_id and id=j.template_version_id and company_id=j.company_id and kind=j.kind and status='approved' for share;
 if not found then v_reason:=coalesce(v_reason,'template_not_approved'); end if;
 select * into s from public.company_sms_settings where company_id=j.company_id for share;
 if live_phone is distinct from phone or live_phone is distinct from p_to or s.from_e164 is distinct from p_from or s.messaging_service_sid is distinct from p_service_sid then v_reason:=coalesce(v_reason,'recipient_or_sender_changed'); end if;
 if v_reason='delivery_unresolved' and v_now+interval '1 minute'<j.expires_at then
   update public.sms_delivery_jobs set status='queued',not_before=v_now+interval '1 minute',attempt_token=null,preparing_until=null,reason=v_reason,updated_at=v_now where id=j.id;
   return jsonb_build_object('started',false,'reason','delivery_unresolved');
 end if;
 if v_reason is null then
   select timezone into tz from public.sms_automation_settings where company_id=j.company_id for share;
   tz:=coalesce(tz,'America/New_York');
   v_open:=private.next_sms_open(v_now,tz,s.quiet_start_hour,s.quiet_end_hour);
   if v_open>v_now then
     if v_open<j.expires_at then
       update public.sms_delivery_jobs set status='queued',not_before=v_open,attempt_token=null,preparing_until=null,reason='quiet_hours',updated_at=v_now where id=j.id;
       return jsonb_build_object('started',false,'reason','quiet_hours');
     end if;
     v_reason:='quiet_hours_expired';
   end if;
 end if;
 if v_reason is not null then
   update public.sms_delivery_jobs set status='skipped',reason=v_reason,updated_at=v_now where id=j.id;
   return jsonb_build_object('started',false,'reason',v_reason);
 end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 1600 or p_body~'\{[[:alnum:]_]+\}' or p_segments is null or p_segments not between 1 and 6 then
   update public.sms_delivery_jobs set status='skipped',reason='invalid_render',updated_at=v_now where id=j.id;
   return jsonb_build_object('started',false,'reason','invalid_render');
 end if;
 -- Phone/template/sender locks can consume a lease. Recheck at the last
 -- database boundary; this is reentrant for the setter lock already held.
 select private.sms_us_phone(coalesce(l.phone_e164,l.phone)) into live_phone from public.leads l where id=j.lead_id and company_id=j.company_id for share;
 if live_phone is distinct from phone or live_phone is distinct from p_to then v_reason:='recipient_or_sender_changed';
 elsif j.preparing_until<=clock_timestamp() or j.expires_at<=clock_timestamp() then v_reason:='expired';
 elsif j.source='manual' then
   begin perform private.lock_setter_booking_claim(j.company_id,j.actor_id,j.task_id,j.task_claim_token);
   exception when sqlstate '40001' or sqlstate '42501' then v_reason:='claim_changed'; end;
 end if;
 v_reason:=coalesce(v_reason,private.sms_delivery_block_reason(j));
 if v_reason is not null then
   update public.sms_delivery_jobs set status='skipped',reason=v_reason,updated_at=clock_timestamp() where id=j.id;
   return jsonb_build_object('started',false,'reason',v_reason);
 end if;
 insert into public.sms_messages(company_id,lead_id,direction,body,from_e164,to_e164,status,segments,sent_by,approved_delivery_id)
 values(j.company_id,j.lead_id,'outbound',p_body,s.from_e164,phone,'sending',p_segments,j.actor_id,j.id) returning id into m_id;
 update public.sms_delivery_jobs set status='sending',message_id=m_id,started_at=clock_timestamp(),preparing_until=null,updated_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('started',true,'message_id',m_id);
end $$;

create function public.settle_approved_sms_delivery(p_id uuid,p_token uuid,p_outcome text,p_sid text,p_status text,p_error_code text) returns text
language plpgsql security definer set search_path='' as $$
declare j public.sms_delivery_jobs%rowtype; m public.sms_messages%rowtype; next_status text;
begin
 select * into j from public.sms_delivery_jobs where id=p_id for update;
 if not found or j.attempt_token is distinct from p_token then return 'ignored'; end if;
 if j.status='accepted' then return 'accepted'; end if;
 if j.status='preparing' and p_outcome='skipped' then
   if p_error_code not in ('booking_link_unavailable','no_approved_template','unfilled','too_long','invalid_render','client_not_ready') or p_error_code is null then raise exception 'Invalid preparation failure'; end if;
   update public.sms_delivery_jobs set status='skipped',reason=p_error_code,preparing_until=null,updated_at=clock_timestamp() where id=j.id;
   return 'skipped';
 end if;
 if j.status not in ('sending','unknown') then return j.status; end if;
 select * into m from public.sms_messages where id=j.message_id and company_id=j.company_id for update;
 if not found then raise exception 'Delivery conversation record missing'; end if;
 if p_outcome='accepted' then
   if p_sid is null or p_sid!~'^(SM|MM)[0-9a-fA-F]{32}$' or private.sms_status_rank(p_status)<0 then raise exception 'Invalid provider response'; end if;
   if m.provider_sid is not null and m.provider_sid<>p_sid then raise exception 'Provider message mismatch'; end if;
   next_status:=case when private.sms_status_rank(p_status)>private.sms_status_rank(m.status) then p_status else m.status end;
   update public.sms_messages set provider_sid=p_sid,status=next_status,status_updated_at=clock_timestamp() where id=m.id;
   update public.sms_delivery_jobs set status='accepted',reason=null,updated_at=clock_timestamp() where id=j.id;
   return 'accepted';
 elsif p_outcome='rejected' then
   update public.sms_messages set status='failed',error_code=left(p_error_code,100),status_updated_at=clock_timestamp() where id=m.id and provider_sid is null;
   update public.sms_delivery_jobs set status='failed',reason=coalesce(left(p_error_code,100),'provider_rejected'),updated_at=clock_timestamp() where id=j.id;
   return 'failed';
 elsif p_outcome='unknown' then
   update public.sms_messages set status='unknown',error_code=left(p_error_code,100),status_updated_at=clock_timestamp() where id=m.id and provider_sid is null;
   update public.sms_delivery_jobs set status='unknown',reason=coalesce(left(p_error_code,100),'acceptance_unknown'),updated_at=clock_timestamp() where id=j.id;
   return 'unknown';
 end if;
 raise exception 'Unsupported delivery settlement';
end $$;

create function public.apply_approved_sms_callback(p_company_id uuid,p_delivery_id uuid,p_token uuid,p_sid text,p_status text,p_to text,p_from text,p_error_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.sms_delivery_jobs%rowtype; m public.sms_messages%rowtype; begin
 if p_sid is null or p_sid!~'^(SM|MM)[0-9a-fA-F]{32}$' or private.sms_status_rank(p_status)<1 then return false; end if;
 select * into j from public.sms_delivery_jobs where id=p_delivery_id and company_id=p_company_id for update;
 if not found or j.attempt_token is distinct from p_token or (j.status not in ('sending','unknown','accepted') and not coalesce(j.status='skipped' and j.reason='operator_verified_not_sent',false)) then return false; end if;
 select * into m from public.sms_messages where id=j.message_id and company_id=p_company_id and approved_delivery_id=j.id for update;
 if not found or m.to_e164 is distinct from p_to or m.from_e164 is distinct from p_from or (m.provider_sid is not null and m.provider_sid<>p_sid)
 or exists(select 1 from public.sms_messages where provider_sid=p_sid and id<>m.id) then return false; end if;
 -- An operator attestation is not provider proof. Preserve its audit record,
 -- but let this exact signed attempt replace its synthetic failure status.
 update public.sms_messages set provider_sid=p_sid,status=case when (m.provider_sid is null and m.error_code='operator_verified_not_sent') or private.sms_status_rank(p_status)>private.sms_status_rank(m.status) then p_status else m.status end,
 error_code=case when (m.provider_sid is null and m.error_code='operator_verified_not_sent') or private.sms_status_rank(p_status)>private.sms_status_rank(m.status) then nullif(left(p_error_code,100),'') else m.error_code end,status_updated_at=clock_timestamp() where id=m.id;
 update public.sms_delivery_jobs set status='accepted',reason=null,updated_at=clock_timestamp() where id=j.id;
 return true;
end $$;

create function public.sweep_approved_sms_deliveries() returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
 update public.sms_delivery_jobs set status='skipped',reason='expired',updated_at=clock_timestamp() where status in ('queued','preparing') and expires_at<=clock_timestamp();
 get diagnostics n=row_count;
 with abandoned as (
   update public.sms_delivery_jobs set status='unknown',reason='worker_interrupted',updated_at=clock_timestamp()
   where status='sending' and started_at<clock_timestamp()-interval '2 minutes' returning message_id,company_id
 ) update public.sms_messages m set status='unknown',error_code='worker_interrupted',status_updated_at=clock_timestamp()
 from abandoned a where m.id=a.message_id and m.company_id=a.company_id and m.provider_sid is null;
 return n;
end $$;

create function public.resolve_sms_delivery(p_id uuid,p_resolution text,p_provider_sid text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); j public.sms_delivery_jobs%rowtype; begin
 p_provider_sid:=nullif(btrim(p_provider_sid),'');
 if p_resolution is null or p_resolution not in ('accepted','not_sent') or length(btrim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'Verify Twilio logs and explain the resolution' using errcode='22023'; end if;
 select * into j from public.sms_delivery_jobs where id=p_id and company_id=c for update;
 if not found or j.status<>'unknown' then raise exception 'Unknown delivery access required' using errcode='42501'; end if;
 if p_resolution='accepted' then
   if p_provider_sid is null or p_provider_sid!~'^(SM|MM)[0-9a-fA-F]{32}$' then raise exception 'A verified Twilio message SID is required' using errcode='22023'; end if;
   perform public.settle_approved_sms_delivery(j.id,j.attempt_token,'accepted',p_provider_sid,'queued',null);
 else
   if p_provider_sid is not null then raise exception 'A not-sent resolution cannot attach a provider SID' using errcode='22023'; end if;
   update public.sms_messages set status='failed',error_code='operator_verified_not_sent',status_updated_at=clock_timestamp() where id=j.message_id and company_id=c and provider_sid is null;
   if not found then raise exception 'Delivery already has provider evidence' using errcode='22023'; end if;
   update public.sms_delivery_jobs set status='skipped',reason='operator_verified_not_sent',updated_at=clock_timestamp() where id=j.id;
 end if;
 insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,metadata) values(c,auth.uid(),'sms_delivery_operator_verified','sms_delivery',j.id,jsonb_build_object('resolution',p_resolution,'providerSid',p_provider_sid,'note',btrim(p_note),'evidenceSource','operator_attestation'));
end $$;

create function private.schedule_approved_booking_sms() returns trigger language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_due timestamptz; v_deadline timestamptz; v_kind text;
begin
 if tg_op='UPDATE' and (new.revision,new.status,new.scheduled_at) is not distinct from (old.revision,old.status,old.scheduled_at) then return new; end if;
 -- Runs under the appointment row lock. A sender takes this lock BEFORE a
 -- delivery row, so cancelling obsolete intents cannot invert that order.
 update public.sms_delivery_jobs set status='skipped',reason='stale_appointment',updated_at=v_now
 where appointment_id=new.id and status in ('queued','preparing')
 and (appointment_revision<>new.revision or new.status not in ('scheduled','confirmed'));
 -- Status-only confirmation must not backfill bookings created before enablement.
 if tg_op='UPDATE' and new.revision=old.revision and new.scheduled_at is not distinct from old.scheduled_at then return new; end if;
 if new.meeting_type is distinct from 'virtual' or new.booking_link_id is null or new.status not in ('scheduled','confirmed')
 or new.scheduled_at<=v_now or not exists(select 1 from public.sms_automation_settings where company_id=new.company_id and enabled)
 or not private.setter_eligible(new.company_id,new.lead_id) then return new; end if;
 -- No enable-time backfill. Only this actual booking/revision event creates
 -- intents; uniqueness makes repeated writes of that revision harmless.
 v_kind:=case when new.revision=1 then 'booking_confirmation' else 'booking_rescheduled' end;
 v_due:=v_now+interval '20 seconds';v_deadline:=least(v_now+interval '6 hours',new.scheduled_at);
 if v_deadline>v_due then
   insert into public.sms_delivery_jobs(company_id,lead_id,source,kind,appointment_id,appointment_revision,not_before,expires_at)
   values(new.company_id,new.lead_id,'automatic',v_kind,new.id,new.revision,v_due,v_deadline) on conflict do nothing;
 end if;
 v_due:=new.scheduled_at-interval '24 hours';v_deadline:=least(v_due+interval '6 hours',new.scheduled_at-interval '2 hours');
 if v_due>=v_now+interval '1 hour' then
   insert into public.sms_delivery_jobs(company_id,lead_id,source,kind,appointment_id,appointment_revision,not_before,expires_at)
   values(new.company_id,new.lead_id,'automatic','reminder_day',new.id,new.revision,v_due,v_deadline) on conflict do nothing;
 end if;
 v_due:=new.scheduled_at-interval '1 hour';v_deadline:=new.scheduled_at-interval '5 minutes';
 if v_due>=v_now+interval '15 minutes' then
   insert into public.sms_delivery_jobs(company_id,lead_id,source,kind,appointment_id,appointment_revision,not_before,expires_at)
   values(new.company_id,new.lead_id,'automatic','reminder_hour',new.id,new.revision,v_due,v_deadline) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger approved_booking_sms after insert or update of revision,status,scheduled_at on public.appointments for each row execute function private.schedule_approved_booking_sms();

create function private.pause_sms_on_reply() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.direction<>'inbound' or private.sms_us_phone(new.from_e164) is null then return new; end if;
 perform private.write_sms_pause(new.company_id,new.from_e164,true,null,'inbound_reply');
 if new.lead_id is not null and private.setter_eligible(new.company_id,new.lead_id)
 and exists(select 1 from public.setter_queue_settings where company_id=new.company_id and enabled) then
   insert into public.tasks(company_id,lead_id,title,description,queue_bucket,origin,due_at)
   values(new.company_id,new.lead_id,'Review homeowner text reply','Automatic texts are paused. Review the conversation before resuming.','handoff','sms_reply',clock_timestamp())
   on conflict(company_id,lead_id) where origin='sms_reply' and status='open' do nothing;
 end if;
 return new;
end $$;
create trigger approved_sms_reply_pause after insert on public.sms_messages for each row execute function private.pause_sms_on_reply();

create function public.get_sms_control_panel() returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.sms_admin_company(); begin
 return jsonb_build_object('company_id',c,'company_name',(select name from public.companies where id=c),
 'settings',jsonb_build_object('enabled',coalesce((select enabled from public.sms_automation_settings where company_id=c),false),
   'timezone',coalesce((select timezone from public.sms_automation_settings where company_id=c),'America/New_York')),
 'sender_ready',exists(select 1 from public.company_sms_settings where company_id=c and enabled),
 'templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.kind,t.version desc) from (
   select id,kind,version,body,status,created_at,approved_at from public.sms_template_versions where company_id=c order by created_at desc limit 100) t),'[]'::jsonb),
 'deliveries',coalesce((select jsonb_agg(to_jsonb(d) order by (d.status='unknown') desc,d.created_at desc) from (
   select j.id,j.kind,j.source,j.status,j.reason,j.created_at,j.not_before,j.expires_at,j.appointment_revision,
     m.status as message_status,m.provider_sid,l.name as lead_name
   from public.sms_delivery_jobs j join public.leads l on l.id=j.lead_id and l.company_id=j.company_id
   left join public.sms_messages m on m.id=j.message_id and m.company_id=j.company_id
   where j.company_id=c and (j.status='unknown' or j.id in (select recent.id from public.sms_delivery_jobs recent where recent.company_id=c order by recent.created_at desc limit 100)) order by (j.status='unknown') desc,j.created_at desc) d),'[]'::jsonb),
 'pauses',coalesce((select jsonb_agg(to_jsonb(p) order by updated_at desc) from (
   select phone_e164,reason,updated_at from public.sms_phone_pauses where company_id=c and paused order by updated_at desc limit 100) p),'[]'::jsonb));
end $$;

revoke all on function private.sms_admin_company(),private.sms_us_phone(text),private.next_sms_open(timestamptz,text,integer,integer),private.sms_status_rank(text),
 private.validate_sms_template(text,text),private.guard_sms_template_version(),private.write_sms_pause(uuid,text,boolean,uuid,text),
 private.sms_delivery_block_reason(public.sms_delivery_jobs),private.schedule_approved_booking_sms(),private.pause_sms_on_reply() from public,anon,authenticated;
revoke all on function public.save_sms_template_draft(text,text),public.approve_sms_template(uuid),public.retire_sms_template(uuid),public.save_sms_automation_settings(boolean,text),
 public.get_setter_texting_context(uuid,uuid),public.queue_setter_template_sms(uuid,uuid,uuid),public.set_setter_sms_pause(uuid,uuid,boolean),public.set_company_sms_pause(text,boolean),
 public.resolve_sms_delivery(uuid,text,text,text),public.get_sms_control_panel() from public,anon,authenticated;
grant execute on function public.save_sms_template_draft(text,text),public.approve_sms_template(uuid),public.retire_sms_template(uuid),public.save_sms_automation_settings(boolean,text),
 public.get_setter_texting_context(uuid,uuid),public.queue_setter_template_sms(uuid,uuid,uuid),public.set_setter_sms_pause(uuid,uuid,boolean),public.set_company_sms_pause(text,boolean),
 public.resolve_sms_delivery(uuid,text,text,text),public.get_sms_control_panel() to authenticated;
revoke all on function public.claim_approved_sms_delivery(uuid,uuid),public.start_approved_sms_delivery(uuid,uuid,uuid,text,text,text,text,integer),
 public.settle_approved_sms_delivery(uuid,uuid,text,text,text,text),public.apply_approved_sms_callback(uuid,uuid,uuid,text,text,text,text,text),public.sweep_approved_sms_deliveries() from public,anon,authenticated;
grant execute on function public.claim_approved_sms_delivery(uuid,uuid),public.start_approved_sms_delivery(uuid,uuid,uuid,text,text,text,text,integer),
 public.settle_approved_sms_delivery(uuid,uuid,text,text,text,text),public.apply_approved_sms_callback(uuid,uuid,uuid,text,text,text,text,text),public.sweep_approved_sms_deliveries() to service_role;
