begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();
-- CI uses 56322. Copy with the isolated project's port for local verification.
select extensions.dblink_connect('ab_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('ab_home','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('ab_setter','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('ab_gate',$$
 insert into public.companies(id,name) values('b7000000-0000-4000-8000-000000000001','Assisted race');
 insert into auth.users(id,email) values('b7000000-0000-4000-8000-000000000101','assisted-race@example.com');
 insert into public.admin_profiles(id,company_id,display_name) values('b7000000-0000-4000-8000-000000000101','b7000000-0000-4000-8000-000000000001','Race setter');
 insert into public.setter_queue_settings(company_id,enabled) values('b7000000-0000-4000-8000-000000000001',true);
 insert into public.company_setters(company_id,user_id,on_shift_until) values('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000101',now()+interval '1 hour');
 insert into public.leads(id,company_id,name,phone,email,submitted_address) values
 ('b7000000-0000-4000-8000-000000000201','b7000000-0000-4000-8000-000000000001','Homeowner','+16095550701','race-home@example.com','1 Test Lane'),
 ('b7000000-0000-4000-8000-000000000202','b7000000-0000-4000-8000-000000000001','Assisted','+16095550702','race-assisted@example.com','2 Test Lane');
 insert into public.tasks(id,company_id,lead_id,title,queue_bucket,claim_user_id,claim_token,claim_expires_at) values
 ('b7000000-0000-4000-8000-000000000301','b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000202','Assisted booking','call_request',
 'b7000000-0000-4000-8000-000000000101','b7000000-0000-4000-8000-000000000401',now()+interval '15 minutes');
 insert into public.booking_links(id,company_id,lead_id,source,expires_at) values
 ('b7000000-0000-4000-8000-000000000501','b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000201','staff',now()+interval '30 days'),
 ('b7000000-0000-4000-8000-000000000502','b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000202','staff',now()+interval '30 days');
 do $body$ begin perform public.save_booking_settings('b7000000-0000-4000-8000-000000000001',
 '{"isEnabled":true,"googleCalendarId":"race@example.com","meetingDurationMinutes":30,"slotIntervalMinutes":30,"bufferMinutes":0,"minimumNoticeMinutes":60,"bookingHorizonDays":14,"concurrentCapacity":1}',
 (select jsonb_agg(jsonb_build_object('weekday',d,'startMinute',540,'endMinute',1020)) from generate_series(0,6) d),null); end $body$;
$$);
select extensions.dblink_exec('ab_gate','begin');
select extensions.dblink_exec('ab_gate',$$do $body$ begin perform private.lock_virtual_booking('b7000000-0000-4000-8000-000000000001'); end $body$;$$);
select extensions.dblink_send_query('ab_home',$$
 select outcome from public.book_virtual_consultation('b7000000-0000-4000-8000-000000000501',
 (((now() at time zone 'America/New_York')::date+5)+time '10:00') at time zone 'America/New_York',null,null,'203.0.113.71')
$$);
select extensions.dblink_send_query('ab_setter',$$
 select outcome from public.save_setter_virtual_booking('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000101',
 'b7000000-0000-4000-8000-000000000301','b7000000-0000-4000-8000-000000000401','b7000000-0000-4000-8000-000000000502','book',
 (((now() at time zone 'America/New_York')::date+5)+time '10:00') at time zone 'America/New_York',null,null,null,null,'203.0.113.72')
$$);
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('ab_home'),1,'homeowner waits on the shared capacity lock');
select is(extensions.dblink_is_busy('ab_setter'),1,'setter waits on the same capacity lock');
select extensions.dblink_exec('ab_gate','commit');
create temporary table ab_race_results as select * from extensions.dblink_get_result('ab_home') as r(outcome text);
insert into ab_race_results select * from extensions.dblink_get_result('ab_setter') as r(outcome text);
select is((select count(*)::integer from ab_race_results where outcome='booked'),1,'only one caller reserves the final seat');
select is((select count(*)::integer from ab_race_results where outcome='unavailable'),1,'the competing caller receives slot contention');
select is((select count(*)::integer from public.appointments where company_id='b7000000-0000-4000-8000-000000000001'),1,'capacity is never oversubscribed');
select extensions.dblink_disconnect('ab_home');
select extensions.dblink_disconnect('ab_setter');
-- A claim can expire while waiting for the capacity lock. A save must roll
-- back even if it was valid before that wait, not merely at request entry.
select extensions.dblink_connect('ab_expiry','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('ab_gate',$$update public.tasks set claim_expires_at=clock_timestamp()+interval '1 second' where id='b7000000-0000-4000-8000-000000000301'$$);
select extensions.dblink_exec('ab_gate','begin');
select extensions.dblink_exec('ab_gate',$$do $body$ begin perform private.lock_virtual_booking('b7000000-0000-4000-8000-000000000001'); end $body$;$$);
select extensions.dblink_send_query('ab_expiry',$$
 select outcome from public.save_setter_virtual_booking('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000101',
 'b7000000-0000-4000-8000-000000000301','b7000000-0000-4000-8000-000000000401','b7000000-0000-4000-8000-000000000502','book',
 (((now() at time zone 'America/New_York')::date+5)+time '11:00') at time zone 'America/New_York',null,null,null,null,'203.0.113.73')
$$);
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('ab_expiry'),1,'save starts with a valid claim then waits for capacity');
select pg_sleep(1.1);
select extensions.dblink_exec('ab_gate','commit');
select is((select count(*)::integer from extensions.dblink_get_result('ab_expiry',false) as r(outcome text)),0,'expired waiting save returns no successful outcome');
select ok(extensions.dblink_error_message('ab_expiry') like '%Claim expired or changed; reload the queue%','expiry during lock wait is rejected');
select is((select count(*)::integer from public.appointments where company_id='b7000000-0000-4000-8000-000000000001'),1,'denied waiting save leaves capacity unchanged');
select extensions.dblink_disconnect('ab_expiry');
select extensions.dblink_exec('ab_gate',$$
 delete from public.audit_log where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.domain_events where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.appointments where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.tasks where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.leads where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.company_setters where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.admin_profiles where company_id='b7000000-0000-4000-8000-000000000001';
 delete from public.company_memberships where company_id='b7000000-0000-4000-8000-000000000001';
 delete from auth.users where id='b7000000-0000-4000-8000-000000000101';
 delete from public.companies where id='b7000000-0000-4000-8000-000000000001';
$$);
select extensions.dblink_disconnect('ab_gate');
select * from finish();
rollback;
