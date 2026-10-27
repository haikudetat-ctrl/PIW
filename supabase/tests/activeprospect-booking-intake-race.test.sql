begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Use the repository pgTAP harness port. Isolated local runs must copy this
-- test and substitute their own published port, as for the other race tests.
select extensions.dblink_connect('ap_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('ap_worker_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('ap_worker_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('ap_gate',$$insert into public.companies(id,name) values ('a2000000-0000-4000-8000-000000000001','AP concurrency fixture')$$);
select extensions.dblink_exec('ap_gate','begin');
select extensions.dblink_exec('ap_gate',$$do $body$ begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array('ap-contact','a2000000-0000-4000-8000-000000000001'::uuid,'+16095550190')::text,0)); end $body$;$$);

select extensions.dblink_send_query('ap_worker_a',$$select receipt_id,state,lead_id from public.accept_activeprospect_booking_intake(
 'a2000000-0000-4000-8000-000000000001','race-flow','virtual','piw',
 '{"schema_version":1,"lead_id":"race-a","flow_id":"race-flow","submitted_at":"2026-10-27T14:00:00Z","is_test":false,"source":{"id":"vendor","name":"Vendor"},"lead":{"name":"Dana","phone":"+16095550190","email":"dana@example.com","submitted_address":"90 Test Lane"}}')$$);
select extensions.dblink_send_query('ap_worker_b',$$select receipt_id,state,lead_id from public.accept_activeprospect_booking_intake(
 'a2000000-0000-4000-8000-000000000001','race-flow','virtual','piw',
 '{"schema_version":1,"lead_id":"race-b","flow_id":"race-flow","submitted_at":"2026-10-27T14:00:00Z","is_test":false,"source":{"id":"vendor","name":"Vendor"},"lead":{"name":"Dana","phone":"+16095550190","email":"dana@example.com","submitted_address":"90 Test Lane"}}')$$);
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('ap_worker_a'),1,'first submission waits for contact ownership lock');
select is(extensions.dblink_is_busy('ap_worker_b'),1,'competing submission waits for the same contact ownership lock');
select extensions.dblink_exec('ap_gate','commit');
create temporary table ap_race_a as select * from extensions.dblink_get_result('ap_worker_a') as r(receipt_id uuid,state text,lead_id uuid);
create temporary table ap_race_b as select * from extensions.dblink_get_result('ap_worker_b') as r(receipt_id uuid,state text,lead_id uuid);
select is((select lead_id from ap_race_a),(select lead_id from ap_race_b),'competing submissions converge on the same canonical lead');
select is((select count(*)::integer from public.leads where company_id='a2000000-0000-4000-8000-000000000001'),1,'one lead under contention');
select is((select count(*)::integer from public.tasks where company_id='a2000000-0000-4000-8000-000000000001'),1,'one setter task under contention');
select is((select count(*)::integer from public.domain_events where company_id='a2000000-0000-4000-8000-000000000001'),1,'one workflow event under contention');
select is((select count(*)::integer from public.activeprospect_intake_receipts where company_id='a2000000-0000-4000-8000-000000000001'),2,'both source submissions retain evidence');

select extensions.dblink_connect('ap_retry_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('ap_retry_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('ap_gate','begin');
select extensions.dblink_exec('ap_gate',$$do $body$ begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array('ap-receipt','a2000000-0000-4000-8000-000000000001'::uuid,'race-flow','same-delivery',false)::text,0)); end $body$;$$);
create temporary table ap_retry_query as select $$select receipt_id,lead_id,duplicate from public.accept_activeprospect_booking_intake(
 'a2000000-0000-4000-8000-000000000001','race-flow','virtual','piw',
 '{"schema_version":1,"lead_id":"same-delivery","flow_id":"race-flow","submitted_at":"2026-10-27T14:00:00Z","is_test":false,"source":{"id":"vendor","name":"Vendor"},"lead":{"name":"Dana","phone":"+16095550191","email":"dana@example.com","submitted_address":"91 Test Lane"}}')$$ as query;
select extensions.dblink_send_query('ap_retry_a',(select query from ap_retry_query));
select extensions.dblink_send_query('ap_retry_b',(select query from ap_retry_query));
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('ap_retry_a'),1,'first retry waits for receipt identity lock');
select is(extensions.dblink_is_busy('ap_retry_b'),1,'second retry waits for receipt identity lock');
select extensions.dblink_exec('ap_gate','commit');
create temporary table ap_retries as select * from extensions.dblink_get_result('ap_retry_a') as r(receipt_id uuid,lead_id uuid,duplicate boolean);
insert into ap_retries select * from extensions.dblink_get_result('ap_retry_b') as r(receipt_id uuid,lead_id uuid,duplicate boolean);
select is((select count(distinct receipt_id)::integer from ap_retries),1,'identical concurrent retries share one receipt');
select is((select count(*)::integer from ap_retries where duplicate),1,'exactly one retry is reported as a duplicate');
select is((select count(*)::integer from public.leads where company_id='a2000000-0000-4000-8000-000000000001' and phone_e164='+16095550191'),1,'identical retries create one graph');
select extensions.dblink_disconnect('ap_retry_a');
select extensions.dblink_disconnect('ap_retry_b');

select extensions.dblink_exec('ap_gate',$$
 delete from public.activeprospect_intake_receipts where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.booking_contact_ownership where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.tasks where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.lead_consents where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.event_outbox where event_id in (select id from public.domain_events where company_id='a2000000-0000-4000-8000-000000000001');
 delete from public.domain_events where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.pipeline_runs where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.leads where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.properties where company_id='a2000000-0000-4000-8000-000000000001';
 delete from public.companies where id='a2000000-0000-4000-8000-000000000001';
$$);
select extensions.dblink_disconnect('ap_worker_a');
select extensions.dblink_disconnect('ap_worker_b');
select extensions.dblink_disconnect('ap_gate');
select * from finish();
rollback;
