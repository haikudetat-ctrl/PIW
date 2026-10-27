begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();
-- Copy with the isolated project's port when running outside the CI stack.
select extensions.dblink_connect('sq_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('sq_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('sq_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('sq_gate',$$
 insert into public.companies(id,name) values('b2000000-0000-4000-8000-000000000001','Setter race fixture');
 insert into auth.users(id,email) values('b2000000-0000-4000-8000-000000000101','sq-race-a@example.com'),('b2000000-0000-4000-8000-000000000102','sq-race-b@example.com');
 insert into public.admin_profiles(id,company_id,display_name) values
 ('b2000000-0000-4000-8000-000000000101','b2000000-0000-4000-8000-000000000001','Race A'),('b2000000-0000-4000-8000-000000000102','b2000000-0000-4000-8000-000000000001','Race B');
 insert into public.setter_queue_settings(company_id,enabled) values('b2000000-0000-4000-8000-000000000001',true);
 insert into public.company_setters(company_id,user_id,on_shift_until) values
 ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000101',now()+interval '1 hour'),('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000102',now()+interval '1 hour');
 insert into public.leads(id,company_id,name,phone,email,submitted_address) values
 ('b2000000-0000-4000-8000-000000000201','b2000000-0000-4000-8000-000000000001','Race homeowner','+16095550301','sq-race-home@example.com','1 Race Lane');
 insert into public.tasks(company_id,lead_id,title,queue_bucket,due_at) values
 ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000201','First task','handoff',now()),
 ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000201','Same lead other task','follow_up',now());
$$);
select extensions.dblink_exec('sq_a',$$set role authenticated; set request.jwt.claim.sub='b2000000-0000-4000-8000-000000000101'$$);
select extensions.dblink_exec('sq_b',$$set role authenticated; set request.jwt.claim.sub='b2000000-0000-4000-8000-000000000102'$$);
select extensions.dblink_exec('sq_gate','begin');
select extensions.dblink_exec('sq_gate',$$do $body$ begin perform pg_advisory_xact_lock(hashtextextended('setter-company:b2000000-0000-4000-8000-000000000001',0)); end $body$;$$);
select extensions.dblink_send_query('sq_a','select public.claim_setter_task()');
select extensions.dblink_send_query('sq_b','select public.claim_setter_task()');
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('sq_a'),1,'first setter waits for company claim lock');
select is(extensions.dblink_is_busy('sq_b'),1,'competing setter waits for company claim lock');
select extensions.dblink_exec('sq_gate','commit');
create temporary table sq_results as select * from extensions.dblink_get_result('sq_a') as r(data jsonb);
insert into sq_results select * from extensions.dblink_get_result('sq_b') as r(data jsonb);
select is((select count(*)::integer from sq_results where data is not null),1,'only one setter receives the homeowner');
select is((select count(*)::integer from public.tasks where company_id='b2000000-0000-4000-8000-000000000001' and claim_user_id is not null),1,'same lead cannot be claimed through its other task');
select extensions.dblink_disconnect('sq_a');
select extensions.dblink_disconnect('sq_b');
select extensions.dblink_exec('sq_gate',$$
 delete from public.tasks where company_id='b2000000-0000-4000-8000-000000000001';
 delete from public.leads where company_id='b2000000-0000-4000-8000-000000000001';
 delete from public.company_setters where company_id='b2000000-0000-4000-8000-000000000001';
 delete from public.admin_profiles where company_id='b2000000-0000-4000-8000-000000000001';
 delete from public.company_memberships where company_id='b2000000-0000-4000-8000-000000000001';
 delete from auth.users where id in ('b2000000-0000-4000-8000-000000000101','b2000000-0000-4000-8000-000000000102');
 delete from public.companies where id='b2000000-0000-4000-8000-000000000001';
$$);
select extensions.dblink_disconnect('sq_gate');
select * from finish();
rollback;
