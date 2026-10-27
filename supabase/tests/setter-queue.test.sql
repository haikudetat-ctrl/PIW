begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','company_setters','setter enrollment is separate from CRM roles');
select has_column('public','tasks','queue_bucket','tasks can join the setter queue');
select has_table('public','setter_call_outcomes','call outcomes are durable');

insert into public.companies(id,name) values
 ('b1000000-0000-4000-8000-000000000001','Setter A'),('b1000000-0000-4000-8000-000000000002','Setter B');
insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000101','setter-manager@example.com'),
 ('b1000000-0000-4000-8000-000000000102','setter-one@example.com'),
 ('b1000000-0000-4000-8000-000000000103','setter-two@example.com'),
 ('b1000000-0000-4000-8000-000000000104','setter-outsider@example.com');
insert into public.admin_profiles(id,company_id,display_name) values
 ('b1000000-0000-4000-8000-000000000101','b1000000-0000-4000-8000-000000000001','Manager'),
 ('b1000000-0000-4000-8000-000000000102','b1000000-0000-4000-8000-000000000001','Setter One'),
 ('b1000000-0000-4000-8000-000000000103','b1000000-0000-4000-8000-000000000001','Setter Two'),
 ('b1000000-0000-4000-8000-000000000104','b1000000-0000-4000-8000-000000000002','Other Manager');
update public.company_memberships set role='employee' where user_id in
 ('b1000000-0000-4000-8000-000000000102','b1000000-0000-4000-8000-000000000103');
insert into public.properties(id,company_id,canonical_address) values
 ('b1000000-0000-4000-8000-000000000011','b1000000-0000-4000-8000-000000000001','1 Setter Lane');
insert into public.leads(id,company_id,property_id,name,phone,email,submitted_address)
 select ('b1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000011',
 'Homeowner ' || n,'+16095550' || lpad(n::text,3,'0'),'home' || n || '@example.com','1 Setter Lane'
 from generate_series(201,210) n;
insert into public.tasks(id,company_id,lead_id,title,due_at,origin) values
 ('b1000000-0000-4000-8000-000000000301','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000201','Call back: homeowner asked for a call',now(),'callback_request'),
 ('b1000000-0000-4000-8000-000000000302','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000202','Contact new virtual inspection lead',now(),null),
 ('b1000000-0000-4000-8000-000000000303','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000203','Manual task',now(),null);

select is((select queue_bucket from public.tasks where id='b1000000-0000-4000-8000-000000000301'),null,'disabled queue does not alter existing operations');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000101',true);
select public.save_setter_queue_settings(true,'America/New_York');
select public.set_company_setter('b1000000-0000-4000-8000-000000000102',true);
select public.set_company_setter('b1000000-0000-4000-8000-000000000103',true);
select throws_ok($$select public.set_company_setter('b1000000-0000-4000-8000-000000000104',true)$$,'42501','Active company member required','manager cannot enroll another tenant');
reset role;
select is((select queue_bucket from public.tasks where id='b1000000-0000-4000-8000-000000000301'),'call_request','enabling adopts pending homeowner call requests');
select is((select queue_bucket from public.tasks where id='b1000000-0000-4000-8000-000000000302'),'new_lead','enabling adopts ActiveProspect intake tasks');
select is((select queue_bucket from public.tasks where id='b1000000-0000-4000-8000-000000000303'),null,'manual tasks are unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
select throws_ok($$select public.save_setter_queue_settings(true,'America/New_York')$$,'42501','Manager access required','setter cannot enable a company queue');
select throws_ok($$select public.claim_setter_task()$$,'42501','Go on shift before claiming a lead','off shift cannot claim');
select public.set_setter_shift(true);
select is((select count(*)::integer from public.leads),0,'enrollment does not open the full CRM');
create temporary table first_claim as select public.claim_setter_task() as data;
grant select on first_claim to public;
select is((select data->>'id' from first_claim),'b1000000-0000-4000-8000-000000000301','call request wins over new lead');
select is((public.claim_setter_task('b1000000-0000-4000-8000-000000000302')->>'id'),(select data->>'id' from first_claim),'another task request resumes unfinished claim');
select throws_ok($$select public.set_setter_shift(false)$$,'22023','Record an outcome before going off shift','cannot skip outcome by leaving shift');
select throws_ok($$select public.finish_setter_task('b1000000-0000-4000-8000-000000000301',gen_random_uuid(),'no_answer')$$,'40001','Claim expired or changed; reload the queue','forged/stale token cannot finish');
select is((public.get_setter_queue()->'current'->'lead'->>'name'),'Homeowner 201','claimed lead context is available');
select throws_ok($$select public.finish_setter_task('b1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from first_claim),'booked_virtual')$$,'22023','A real future appointment is required','booked outcome cannot invent an appointment');
select throws_ok($$select public.finish_setter_task('b1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from first_claim),'disqualified','')$$,'22023','A reason is required','disqualified requires a reason');
select public.record_setter_attempt('b1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from first_claim));
select public.record_setter_attempt('b1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from first_claim));
select public.finish_setter_task('b1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from first_claim),'no_answer');
select public.finish_setter_task('b1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from first_claim),'no_answer');
reset role;
select is((select count(*)::integer from public.setter_call_attempts where task_id='b1000000-0000-4000-8000-000000000301'),1,'retry logs only one manual call attempt per claim');
select is((select count(*)::integer from public.setter_call_outcomes where task_id='b1000000-0000-4000-8000-000000000301'),1,'retry records one outcome');
select is((select count(*)::integer from public.tasks where parent_task_id='b1000000-0000-4000-8000-000000000301'),1,'retry creates one follow-up');
select ok((select due_at between now()+interval '119 minutes' and now()+interval '121 minutes' from public.tasks where parent_task_id='b1000000-0000-4000-8000-000000000301'),'no answer returns to a two-hour follow-up');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000101',true);
select throws_ok($$update public.tasks set status='complete' where id='b1000000-0000-4000-8000-000000000302'$$,'42501','Use the setter queue to change queued tasks','generic completion cannot bypass outcome');
select throws_ok($$update public.tasks set queue_bucket=null where id='b1000000-0000-4000-8000-000000000302'$$,'42501','Use the setter queue to change queued tasks','cannot erase queue metadata to bypass disposition');
select throws_ok($$delete from public.tasks where id='b1000000-0000-4000-8000-000000000302'$$,'42501','permission denied for table tasks','cannot delete queued task to skip outcome');
select lives_ok($$update public.tasks set status='complete' where id='b1000000-0000-4000-8000-000000000303'$$,'generic manual tasks still complete normally');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000104',true);
select is((public.get_setter_queue()->'current'),'null'::jsonb,'other tenant cannot load a claim');
select throws_ok($$select public.claim_setter_task('b1000000-0000-4000-8000-000000000302')$$,'42501','Queue access required','other tenant cannot claim');
reset role;

select ok(not has_function_privilege('anon','public.claim_setter_task(uuid)','execute'),'anonymous callers cannot claim');
select ok(not has_table_privilege('authenticated','public.setter_call_outcomes','insert'),'members cannot forge outcomes');
select ok(not has_table_privilege('authenticated','public.company_setters','update'),'members cannot self-enroll directly');

-- Rank all five buckets. Scheduled callbacks stay private to their assigned
-- setter until the SLA sweep releases them, and future tasks stay hidden.
insert into public.tasks(id,company_id,lead_id,title,queue_bucket,due_at,assigned_to) values
 ('b1000000-0000-4000-8000-000000000304','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000204','Callback','scheduled_callback',now()-interval '1 minute','b1000000-0000-4000-8000-000000000103'),
 ('b1000000-0000-4000-8000-000000000305','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000205','Human review','handoff',now()-interval '1 hour',null),
 ('b1000000-0000-4000-8000-000000000306','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000206','Follow-up','follow_up',now()-interval '2 hours',null),
 ('b1000000-0000-4000-8000-000000000307','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000207','Future','call_request',now()+interval '1 day',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
select is((public.claim_setter_task('b1000000-0000-4000-8000-000000000304')),null::jsonb,'another setter cannot steal an assigned callback before escalation');
select is((public.claim_setter_task('b1000000-0000-4000-8000-000000000307')),null::jsonb,'future call requests cannot be dialed early');
create temporary table new_claim as select public.claim_setter_task() data;
grant select on new_claim to public;
select is((select data->>'id' from new_claim),'b1000000-0000-4000-8000-000000000302','fresh lead ranks before handoff and due follow-up');
select public.finish_setter_task('b1000000-0000-4000-8000-000000000302',(select (data->>'claim_token')::uuid from new_claim),'callback_scheduled',null,now()+interval '1 day');
reset role;
select is((select assigned_to from public.tasks where parent_task_id='b1000000-0000-4000-8000-000000000302'),'b1000000-0000-4000-8000-000000000102'::uuid,'new callback retains the agreeing setter');
select is((select queue_bucket from public.tasks where parent_task_id='b1000000-0000-4000-8000-000000000302'),'scheduled_callback','callback outcome creates a scheduled callback');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000103',true);
select public.set_setter_shift(true);
create temporary table second_claim as select public.claim_setter_task() data;
grant select on second_claim to public;
select is((select data->>'id' from second_claim),'b1000000-0000-4000-8000-000000000304','scheduled callback ranks before handoff');
reset role;
update public.tasks set claim_expires_at=now()-interval '1 second',sla_escalated_at=now() where id='b1000000-0000-4000-8000-000000000304';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
create temporary table reclaimed as select public.claim_setter_task() data;
grant select on reclaimed to public;
select is((select data->>'id' from reclaimed),'b1000000-0000-4000-8000-000000000304','expired, escalated callback can be recovered by another setter');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000103',true);
select throws_ok($$select public.record_setter_attempt('b1000000-0000-4000-8000-000000000304',(select (data->>'claim_token')::uuid from second_claim))$$,'40001','Claim expired or changed; reload the queue','previous claimant cannot act after reassignment');
select is((public.get_setter_queue()->'current'),'null'::jsonb,'previous claimant loses homeowner context');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
select public.finish_setter_task('b1000000-0000-4000-8000-000000000304',(select (data->>'claim_token')::uuid from reclaimed),'not_interested');
reset role;
select is((select reason from public.setter_lead_stops where lead_id='b1000000-0000-4000-8000-000000000204'),'not_interested','stop outcome creates durable exclusion');
update public.leads set is_test=true where id='b1000000-0000-4000-8000-000000000205';
insert into public.booking_contact_ownership(company_id,phone_e164,contact_owner,lead_id) values
 ('b1000000-0000-4000-8000-000000000001','+16095550206','external','b1000000-0000-4000-8000-000000000206');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
select is((public.claim_setter_task()),null::jsonb,'test and externally owned leads cannot be contacted');
reset role;
update public.leads set is_test=false where id='b1000000-0000-4000-8000-000000000205';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
create temporary table handoff_claim as select public.claim_setter_task() data;
grant select on handoff_claim to public;
select is((select data->>'id' from handoff_claim),'b1000000-0000-4000-8000-000000000305','handoff ranks before due follow-up');
reset role;
update public.company_memberships set is_active=false where user_id='b1000000-0000-4000-8000-000000000102';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000102',true);
select throws_ok($$select public.get_setter_queue()$$,'42501','Queue access required','deactivated member immediately loses lead context');
select throws_ok($$select public.record_setter_attempt('b1000000-0000-4000-8000-000000000305',(select (data->>'claim_token')::uuid from handoff_claim))$$,'42501','Queue access required','deactivated member cannot attest a call');
reset role;
select * from finish();
rollback;
