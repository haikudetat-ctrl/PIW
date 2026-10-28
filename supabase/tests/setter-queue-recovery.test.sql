begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.companies(id,name) values('b6000000-0000-4000-8000-000000000001','Setter recovery fixture');
insert into auth.users(id,email) values('b6000000-0000-4000-8000-000000000101','sq-recover-a@example.com'),('b6000000-0000-4000-8000-000000000102','sq-recover-b@example.com');
insert into public.admin_profiles(id,company_id,display_name) values
 ('b6000000-0000-4000-8000-000000000101','b6000000-0000-4000-8000-000000000001','Original setter'),('b6000000-0000-4000-8000-000000000102','b6000000-0000-4000-8000-000000000001','Recovery setter');
update public.company_memberships set role='employee' where company_id='b6000000-0000-4000-8000-000000000001';
insert into public.setter_queue_settings(company_id,enabled) values('b6000000-0000-4000-8000-000000000001',true);
insert into public.company_setters(company_id,user_id,on_shift_until) values
 ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000101',now()+interval '1 hour'),('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000102',now()+interval '1 hour');
insert into public.properties(id,company_id,canonical_address) values('b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000001','1 Recovery Lane');
insert into public.leads(id,company_id,property_id,name,phone,email,submitted_address) values
 ('b6000000-0000-4000-8000-000000000201','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000011','Callback homeowner','+16095550401','sq-callback@example.com','1 Recovery Lane'),
 ('b6000000-0000-4000-8000-000000000202','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000011','Recovery homeowner','+16095550402','sq-recover@example.com','2 Recovery Lane');
insert into public.roof_estimates(company_id,lead_id,property_id,public_token) values
 ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000201','b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000401');
insert into public.tasks(id,company_id,lead_id,title,due_at) values
 ('b6000000-0000-4000-8000-000000000301','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000201','Contact new virtual inspection lead',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
create temporary table initial as select public.claim_setter_task() data;
select public.finish_setter_task('b6000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from initial),'callback_scheduled',null,clock_timestamp()+interval '100 milliseconds');
select pg_sleep(0.2);
create temporary table callback_claim as select public.claim_setter_task() data;
grant select on callback_claim to public;
reset role;
create temporary table original_callback as select id,queue_revision from public.tasks where parent_task_id='b6000000-0000-4000-8000-000000000301';
create temporary table homeowner_change as select * from public.request_estimate_callback('b6000000-0000-4000-8000-000000000401','afternoon',clock_timestamp()+interval '1 day');
select is((select task_id from homeowner_change),(select id from original_callback),'homeowner reschedule updates the actual setter-created callback');
select is((select count(*)::integer from public.tasks where lead_id='b6000000-0000-4000-8000-000000000201' and status='open'),1,'one pending callback across homeowner and setter paths');
select ok((select claim_token is null and queue_revision<>(select queue_revision from original_callback) from public.tasks where id=(select id from original_callback)),'homeowner reschedule invalidates the old claim and revision');
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
select throws_ok($$select public.finish_setter_task((select (data->>'id')::uuid from callback_claim),(select (data->>'claim_token')::uuid from callback_claim),'no_answer')$$,'40001','Claim expired or changed; reload the queue','old outcome cannot cancel the homeowner new callback time');
reset role;

insert into public.tasks(id,company_id,lead_id,title,due_at,queue_bucket,assigned_to) values
 ('b6000000-0000-4000-8000-000000000302','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000202','Scheduled callback',now()-interval '1 minute','scheduled_callback','b6000000-0000-4000-8000-000000000101');
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
create temporary table attempted_claim as select public.claim_setter_task('b6000000-0000-4000-8000-000000000302') data;
select public.record_setter_attempt('b6000000-0000-4000-8000-000000000302',(select (data->>'claim_token')::uuid from attempted_claim));
reset role;
update public.tasks set claim_expires_at=clock_timestamp()-interval '1 second' where id='b6000000-0000-4000-8000-000000000302';
-- Even while the original setter stays enrolled/on shift, an expired claim
-- needs disposition recovery without inventing an SLA miss.
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000102',true);
create temporary table recovery as select public.claim_setter_task('b6000000-0000-4000-8000-000000000302') data;
grant select on recovery to public;
select is((select data->>'id' from recovery),'b6000000-0000-4000-8000-000000000302','an attempted expired callback is recoverable by another setter');
select is((public.get_setter_queue()->'current'->>'current_claim_attempted')::boolean,false,'recovered claim has its own unrecorded call attempt');
reset role;
select ok((select attempted_at is not null and sla_escalated_at is null and assigned_to='b6000000-0000-4000-8000-000000000101' from public.tasks where id='b6000000-0000-4000-8000-000000000302'),'recovery keeps attempt evidence and original callback attribution');
-- Now the recovery setter leaves: the original caller must recover it too.
update public.company_memberships set is_active=false where user_id='b6000000-0000-4000-8000-000000000102';
update public.tasks set claim_expires_at=clock_timestamp()-interval '1 second' where id='b6000000-0000-4000-8000-000000000302';
select public.sweep_setter_callback_sla();
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
create temporary table returned as select public.claim_setter_task('b6000000-0000-4000-8000-000000000302') data;
select is((select data->>'id' from returned),'b6000000-0000-4000-8000-000000000302','deactivated claimant does not strand the callback');
select public.record_setter_attempt('b6000000-0000-4000-8000-000000000302',(select (data->>'claim_token')::uuid from returned));
select is((public.get_setter_queue()->'current'->>'current_claim_attempted')::boolean,true,'dialing state is recorded for the new claim token');
select public.finish_setter_task('b6000000-0000-4000-8000-000000000302',(select (data->>'claim_token')::uuid from returned),'handoff','Manager review after a manual call');
reset role;
select is((select count(*)::integer from public.setter_call_attempts where task_id='b6000000-0000-4000-8000-000000000302'),2,'new claim manual attempt survives a non-call handoff outcome');
select is((select count(*)::integer from public.setter_callback_alerts where task_id='b6000000-0000-4000-8000-000000000302'),0,'disposition recovery does not falsely report a missed callback');

-- A callback newly requested during a claimed intake call also supersedes
-- the old task; a later no-answer cannot erase the homeowner's new promise.
insert into public.leads(id,company_id,property_id,name,phone,email,submitted_address) values
 ('b6000000-0000-4000-8000-000000000203','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000011','New callback homeowner','+16095550403','sq-new-callback@example.com','3 Recovery Lane');
insert into public.roof_estimates(company_id,lead_id,property_id,public_token) values
 ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000203','b6000000-0000-4000-8000-000000000011','b6000000-0000-4000-8000-000000000403');
insert into public.tasks(id,company_id,lead_id,title,due_at) values
 ('b6000000-0000-4000-8000-000000000303','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000203','Contact new virtual inspection lead',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
create temporary table intake_claim as select public.claim_setter_task('b6000000-0000-4000-8000-000000000303') data;
grant select on intake_claim to public;
reset role;
select * from public.request_estimate_callback('b6000000-0000-4000-8000-000000000403','afternoon',clock_timestamp()+interval '1 day');
select is((select status::text from public.tasks where id='b6000000-0000-4000-8000-000000000303'),'cancelled','new homeowner callback supersedes an intake task');
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
select throws_ok($$select public.finish_setter_task('b6000000-0000-4000-8000-000000000303',(select (data->>'claim_token')::uuid from intake_claim),'no_answer')$$,'40001','Claim expired or changed; reload the queue','stale intake outcome cannot cancel a new homeowner callback');
reset role;
select is((select count(*)::integer from public.tasks where lead_id='b6000000-0000-4000-8000-000000000203' and status='open' and origin='callback_request'),1,'new homeowner callback remains pending');
select * from finish();
rollback;
