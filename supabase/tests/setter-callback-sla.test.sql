begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public','setter_callback_alerts','callback stages are durable');
insert into public.companies(id,name) values ('b3000000-0000-4000-8000-000000000001','SLA fixture');
insert into auth.users(id,email) values ('b3000000-0000-4000-8000-000000000101','sla-setter@example.com');
insert into public.admin_profiles(id,company_id,display_name) values ('b3000000-0000-4000-8000-000000000101','b3000000-0000-4000-8000-000000000001','Original Setter');
insert into public.setter_queue_settings(company_id,enabled) values ('b3000000-0000-4000-8000-000000000001',true);
insert into public.company_setters(company_id,user_id,on_shift_until) values ('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000101',now()+interval '1 hour');
insert into public.leads(id,company_id,name,phone,email,submitted_address)
 select ('b3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b3000000-0000-4000-8000-000000000001','SLA homeowner','+16095550'||n,'sla'||n||'@example.com','SLA Lane' from generate_series(201,205) n;
insert into public.tasks(id,company_id,lead_id,title,queue_bucket,due_at,assigned_to,claim_user_id,claim_token,claim_expires_at,attempted_at)
 select ('b3000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'b3000000-0000-4000-8000-000000000001',('b3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'Scheduled callback','scheduled_callback',now()-case n when 201 then interval '9 minutes 55 seconds' when 202 then interval '10 minutes' when 203 then interval '30 minutes' when 204 then interval '31 minutes' else interval '31 minutes' end,
 'b3000000-0000-4000-8000-000000000101',case when n=202 then 'b3000000-0000-4000-8000-000000000101'::uuid end,
 case when n=202 then gen_random_uuid() end,case when n=202 then now()+interval '5 minutes' end,case when n=204 then now()-interval '29 minutes' end
 from generate_series(201,205) n;
-- A test lead must never enter recovery.
update public.leads set is_test=true where id='b3000000-0000-4000-8000-000000000205';
set local role service_role;
select lives_ok('select public.sweep_setter_callback_sla()','the actual worker role can execute the sweep');
reset role;
select public.sweep_setter_callback_sla();
select is((select count(*)::integer from public.setter_callback_alerts),3,'one escalation at ten, escalation and miss at thirty');
select is((select claim_user_id from public.tasks where id='b3000000-0000-4000-8000-000000000302'),null::uuid,'ten-minute escalation releases the untouched claim');
select ok((select sla_escalated_at is not null from public.tasks where id='b3000000-0000-4000-8000-000000000302'),'ten-minute callback is flagged for other setters');
select is((select status::text from public.tasks where id='b3000000-0000-4000-8000-000000000303'),'cancelled','thirty-minute window closes');
select is((select count(*)::integer from public.tasks where parent_task_id='b3000000-0000-4000-8000-000000000303' and queue_bucket='handoff'),1,'missed window creates one human recovery task');
select is((select count(*)::integer from public.setter_callback_alerts where task_id='b3000000-0000-4000-8000-000000000304'),0,'attempt prevents escalation even without disposition');
select is((select count(*)::integer from public.setter_callback_alerts where task_id='b3000000-0000-4000-8000-000000000301'),0,'nothing fires before ten minutes');
select is((select count(*)::integer from public.setter_callback_alerts where task_id='b3000000-0000-4000-8000-000000000305'),0,'test lead creates no alert or recovery');
select public.sweep_setter_callback_sla();
select is((select count(*)::integer from public.setter_callback_alerts),3,'sweep replay adds no alerts');
select is((select count(*)::integer from public.notifications where company_id='b3000000-0000-4000-8000-000000000001'),3,'each stage has one in-app manager notification');
select is((select assigned_to from public.setter_callback_alerts where stage='missed'),'b3000000-0000-4000-8000-000000000101'::uuid,'miss retained against the originally assigned setter');
select ok(not has_function_privilege('authenticated','public.sweep_setter_callback_sla()','execute'),'member cannot run the service sweep');
select ok(not has_function_privilege('anon','public.claim_setter_callback_alerts(uuid)','execute'),'anonymous caller cannot claim Slack delivery');

-- Existing homeowner callback RPC changes due_at on its pending task. That
-- must invalidate claims and queued alerts from the previous clock.
create temporary table old_revision as select queue_revision from public.tasks where id='b3000000-0000-4000-8000-000000000302';
update public.tasks set origin='callback_request',claim_user_id='b3000000-0000-4000-8000-000000000101',claim_token=gen_random_uuid(),claim_expires_at=now()+interval '5 minutes' where id='b3000000-0000-4000-8000-000000000302';
update public.tasks set due_at=now()+interval '1 day' where id='b3000000-0000-4000-8000-000000000302';
select ok((select queue_revision<>(select queue_revision from old_revision) from public.tasks where id='b3000000-0000-4000-8000-000000000302'),'reschedule has a new revision');
select ok((select claim_token is null and attempted_at is null and sla_escalated_at is null from public.tasks where id='b3000000-0000-4000-8000-000000000302'),'reschedule invalidates claim and SLA state');
create temporary table delivery as select * from public.claim_setter_callback_alerts('b3000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from delivery),2,'obsolete callback revision cannot be sent to Slack');
select is((select count(*)::integer from public.claim_setter_callback_alerts('b3000000-0000-4000-8000-000000000001')),0,'second sender cannot claim in-flight alerts');
select public.settle_setter_callback_alert(id,claim_token,'sent') from delivery limit 1;
select public.settle_setter_callback_alert(id,gen_random_uuid(),'sent') from delivery;
select is((select count(*)::integer from public.setter_callback_alerts where delivery_status='sent'),1,'stale sender token cannot mark another delivery sent');
update public.setter_callback_alerts set claimed_at=now()-interval '6 minutes' where delivery_status='sending';
select is((select count(*)::integer from public.claim_setter_callback_alerts('b3000000-0000-4000-8000-000000000001')),0,'timed-out send is not blindly retried');
select is((select count(*)::integer from public.setter_callback_alerts where delivery_status='uncertain'),1,'timed-out send is marked for manual reconciliation');
set local role authenticated;
select set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000101',true);
select is((public.get_setter_callback_report()->0->>'missed')::integer,1,'manager sees missed windows per original setter');
reset role;
update public.setter_queue_settings set enabled=false where company_id='b3000000-0000-4000-8000-000000000001';
update public.tasks set due_at=now()-interval '2 hours' where id='b3000000-0000-4000-8000-000000000301';
select public.sweep_setter_callback_sla();
select is((select count(*)::integer from public.setter_callback_alerts),3,'disabled company creates no alerts or recovery');
select * from finish();
rollback;
