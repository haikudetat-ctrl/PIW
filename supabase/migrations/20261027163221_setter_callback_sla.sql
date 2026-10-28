create table public.setter_callback_alerts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade,
 queue_revision uuid not null,
 lead_id uuid not null references public.leads(id) on delete cascade,
 stage text not null check(stage in ('escalated','missed')),
 due_at timestamptz not null,
 assigned_to uuid references public.admin_profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 delivery_status text not null default 'queued' check(delivery_status in ('queued','sending','sent','failed','uncertain')),
 claim_token uuid,
 claimed_at timestamptz,
 settled_at timestamptz,
 unique(task_id,queue_revision,stage)
);
create index setter_callback_alert_pending_idx on public.setter_callback_alerts(company_id,created_at) where delivery_status='queued';
create index setter_callback_misses_idx on public.setter_callback_alerts(company_id,created_at) where stage='missed';
alter table public.setter_callback_alerts enable row level security;
revoke all on public.setter_callback_alerts from anon,authenticated;
grant all on public.setter_callback_alerts to service_role;
grant select on public.setter_callback_alerts to authenticated;
create policy "managers read callback alerts" on public.setter_callback_alerts for select to authenticated using(company_id=(select public.current_company_id()));

create function public.sweep_setter_callback_sla() returns integer
language plpgsql set search_path='' as $$
declare v_company uuid; t public.tasks%rowtype; v_now timestamptz:=clock_timestamp(); v_alert uuid; v_count integer:=0; v_stage text;
begin
 for v_company in select company_id from public.setter_queue_settings where enabled order by company_id loop
   perform pg_advisory_xact_lock(hashtextextended('setter-company:'||v_company::text,0));
   -- Recheck after the lock: disabling and scheduling use the same lock.
   if not exists(select 1 from public.setter_queue_settings where company_id=v_company and enabled) then continue; end if;
   for t in select * from public.tasks where company_id=v_company and status='open' and queue_bucket in ('call_request','scheduled_callback')
     and attempted_at is null and due_at<=v_now-interval '10 minutes' and private.setter_eligible(company_id,lead_id)
     and (sla_escalated_at is null or due_at<=v_now-interval '30 minutes') order by due_at,id limit 500 for update loop
     if t.sla_escalated_at is null then
       update public.tasks set sla_escalated_at=v_now,claim_user_id=null,claim_token=null,claim_expires_at=null,claimed_at=null where id=t.id;
       insert into public.setter_callback_alerts(company_id,task_id,queue_revision,lead_id,stage,due_at,assigned_to)
       values(v_company,t.id,t.queue_revision,t.lead_id,'escalated',t.due_at,t.assigned_to)
       on conflict do nothing returning id into v_alert;
       if v_alert is not null then
         insert into public.notifications(company_id,lead_id,type,title,body,correlation_id)
         values(v_company,t.lead_id,'callback_requested','Callback needs coverage','No call attempt at ten minutes past due. Any on-shift setter can claim it.',v_alert) on conflict do nothing;
         v_count:=v_count+1;
       end if;
     end if;
     if t.due_at<=v_now-interval '30 minutes' then
       update public.tasks set status='cancelled',sla_missed_at=v_now,claim_user_id=null,claim_token=null,claim_expires_at=null,claimed_at=null,updated_at=v_now where id=t.id;
       insert into public.setter_callback_alerts(company_id,task_id,queue_revision,lead_id,stage,due_at,assigned_to)
       values(v_company,t.id,t.queue_revision,t.lead_id,'missed',t.due_at,t.assigned_to)
       on conflict do nothing returning id into v_alert;
       if v_alert is not null then
         insert into public.notifications(company_id,lead_id,type,title,body,correlation_id)
         values(v_company,t.lead_id,'callback_requested','Callback window missed','No call attempt in the thirty-minute window. A human recovery handoff is queued.',v_alert) on conflict do nothing;
         v_count:=v_count+1;
       end if;
       insert into public.tasks(company_id,lead_id,title,description,due_at,queue_bucket,parent_task_id)
       values(v_company,t.lead_id,'Recover missed callback','Review the missed window and agree a new time with the homeowner. No automatic apology text has been sent.',v_now,'handoff',t.id)
       on conflict(parent_task_id) where parent_task_id is not null and queue_bucket is not null do nothing;
     end if;
   end loop;
 end loop;
 return v_count;
end $$;

create function public.claim_setter_callback_alerts(p_company_id uuid)
returns table(id uuid,company_id uuid,stage text,due_at timestamptz,claim_token uuid)
language plpgsql set search_path='' as $$
begin
 -- A lost HTTP response may already have posted. Never retry it blindly.
 update public.setter_callback_alerts a set delivery_status='uncertain',settled_at=clock_timestamp()
 where a.company_id=p_company_id and a.delivery_status='sending' and a.claimed_at<clock_timestamp()-interval '5 minutes';
 return query with pending as (
   select a.id from public.setter_callback_alerts a join public.setter_queue_settings s on s.company_id=a.company_id and s.enabled
   join public.tasks t on t.id=a.task_id and t.company_id=a.company_id and t.queue_revision=a.queue_revision
   where a.company_id=p_company_id and a.delivery_status='queued'
   order by a.created_at,a.id limit 25 for update of a skip locked
 ), claimed as (
   update public.setter_callback_alerts a set delivery_status='sending',claim_token=gen_random_uuid(),claimed_at=clock_timestamp()
   from pending p where a.id=p.id returning a.*
 ) select c.id,c.company_id,c.stage,c.due_at,c.claim_token from claimed c;
end $$;

create function public.settle_setter_callback_alert(p_id uuid,p_claim_token uuid,p_status text) returns void
language plpgsql set search_path='' as $$
begin
 if p_status not in ('sent','failed','uncertain') or p_status is null then raise exception 'Invalid delivery status' using errcode='22023'; end if;
 update public.setter_callback_alerts set delivery_status=p_status,settled_at=clock_timestamp()
 where id=p_id and claim_token=p_claim_token and delivery_status='sending';
end $$;

create function public.get_setter_callback_report() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company uuid:=public.current_company_id(); v_report jsonb;
begin
 if auth.uid() is null or v_company is null then raise exception 'Manager access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.missed desc,r.name),'[]'::jsonb) into v_report from (
   select a.assigned_to,coalesce(p.display_name,'Unassigned') name,count(*)::integer missed,
   count(*) filter(where a.delivery_status in ('failed','uncertain'))::integer delivery_issues
   from public.setter_callback_alerts a left join public.admin_profiles p on p.id=a.assigned_to
   where a.company_id=v_company and a.stage='missed' and a.created_at>=clock_timestamp()-interval '7 days'
   group by a.assigned_to,p.display_name
 ) r;
 return v_report;
end $$;

revoke all on function public.sweep_setter_callback_sla(),public.claim_setter_callback_alerts(uuid),public.settle_setter_callback_alert(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sweep_setter_callback_sla(),public.claim_setter_callback_alerts(uuid),public.settle_setter_callback_alert(uuid,uuid,text) to service_role;
revoke all on function public.get_setter_callback_report() from public,anon;
grant execute on function public.get_setter_callback_report() to authenticated;
