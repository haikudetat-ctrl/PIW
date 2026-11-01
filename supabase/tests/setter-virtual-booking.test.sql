begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('public','get_setter_booking_context',array['uuid','uuid'],'claim-scoped booking context exists');
insert into public.companies(id,name) values
 ('b6000000-0000-4000-8000-000000000001','Assisted booking A'),
 ('b6000000-0000-4000-8000-000000000002','Assisted booking B');
insert into auth.users(id,email) values
 ('b6000000-0000-4000-8000-000000000101','assisted-a@example.com'),
 ('b6000000-0000-4000-8000-000000000102','assisted-competitor@example.com'),
 ('b6000000-0000-4000-8000-000000000103','assisted-b@example.com');
insert into public.admin_profiles(id,company_id,display_name) values
 ('b6000000-0000-4000-8000-000000000101','b6000000-0000-4000-8000-000000000001','Setter A'),
 ('b6000000-0000-4000-8000-000000000102','b6000000-0000-4000-8000-000000000001','Setter Two'),
 ('b6000000-0000-4000-8000-000000000103','b6000000-0000-4000-8000-000000000002','Setter B');
update public.company_memberships set role='employee' where user_id in
 ('b6000000-0000-4000-8000-000000000101','b6000000-0000-4000-8000-000000000102','b6000000-0000-4000-8000-000000000103');
insert into public.setter_queue_settings(company_id,enabled) values
 ('b6000000-0000-4000-8000-000000000001',true),('b6000000-0000-4000-8000-000000000002',true);
insert into public.company_setters(company_id,user_id,on_shift_until) values
 ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000101',now()+interval '1 hour'),
 ('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000102',now()+interval '1 hour'),
 ('b6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000103',now()+interval '1 hour');
insert into public.leads(id,company_id,name,phone,email,submitted_address) values
 ('b6000000-0000-4000-8000-000000000201','b6000000-0000-4000-8000-000000000001','Book One','+16095550601','book-one@example.com','1 Booking Lane'),
 ('b6000000-0000-4000-8000-000000000202','b6000000-0000-4000-8000-000000000001','Book Two','+16095550602','book-two@example.com','2 Booking Lane'),
 ('b6000000-0000-4000-8000-000000000203','b6000000-0000-4000-8000-000000000002','Other tenant','+16095550603','book-other@example.com','3 Booking Lane');
insert into public.tasks(id,company_id,lead_id,title,queue_bucket,due_at) values
 ('b6000000-0000-4000-8000-000000000301','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000201','Book virtual','call_request',now()),
 ('b6000000-0000-4000-8000-000000000302','b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000202','Book virtual','call_request',now());
select public.save_booking_settings('b6000000-0000-4000-8000-000000000001',
 '{"isEnabled":true,"googleCalendarId":"assisted@example.com","meetingDurationMinutes":30,"slotIntervalMinutes":30,"bufferMinutes":0,"minimumNoticeMinutes":60,"bookingHorizonDays":14,"concurrentCapacity":1}',
 (select jsonb_agg(jsonb_build_object('weekday',d,'startMinute',540,'endMinute',1020)) from generate_series(0,6) d),null);
create temporary table ab_times as select
 (((now() at time zone 'America/New_York')::date+5)+time '10:00') at time zone 'America/New_York' as first_slot,
 (((now() at time zone 'America/New_York')::date+5)+time '11:00') at time zone 'America/New_York' as second_slot;
grant select on ab_times to public;
set local role authenticated;
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000101',true);
create temporary table ab_claim as select public.claim_setter_task('b6000000-0000-4000-8000-000000000301') as data;
grant select on ab_claim to public;
create temporary table ab_context as select * from public.get_setter_booking_context(
 'b6000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from ab_claim));
grant select on ab_context to public;
select is((select lead_id from ab_context),'b6000000-0000-4000-8000-000000000201'::uuid,'context resolves only the claimed lead');
select is((select count(*)::integer from public.leads),0,'booking access does not grant employee CRM reads');
select throws_ok($$select public.get_setter_booking_context('b6000000-0000-4000-8000-000000000302',(select (data->>'claim_token')::uuid from ab_claim))$$,
 '40001','Claim expired or changed; reload the queue','another task cannot reuse the token');
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000102',true);
select throws_ok($$select public.get_setter_booking_context('b6000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from ab_claim))$$,
 '40001','Claim expired or changed; reload the queue','another enrolled setter cannot use the claim');
select set_config('request.jwt.claim.sub','b6000000-0000-4000-8000-000000000103',true);
select throws_ok($$select public.get_setter_booking_context('b6000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from ab_claim))$$,
 '40001','Claim expired or changed; reload the queue','another company cannot use the claim');
reset role;

select ok(not has_function_privilege('anon','public.get_setter_booking_context(uuid,uuid)','execute'),'anonymous cannot obtain context');
select ok(not has_function_privilege('authenticated','public.save_setter_virtual_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid,bigint,text,text,inet)','execute'),'browser cannot bypass the Google busy-time check');
select ok(not has_function_privilege('anon','public.save_setter_virtual_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid,bigint,text,text,inet)','execute'),'anonymous cannot commit');

create function pg_temp.ab_save(p_action text,p_start timestamptz,p_appointment uuid default null,p_revision bigint default null)
returns table(outcome text,problem text,appointment_id uuid,scheduled_at timestamptz,duration_minutes integer,revision bigint,event jsonb)
language sql as $$
 select * from public.save_setter_virtual_booking('b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000101',
 'b6000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from ab_claim),(select link_id from ab_context),
 p_action,p_start,p_appointment,p_revision,null,'Discuss porch leak','203.0.113.61')
$$;
set local role service_role;
create temporary table ab_booked as select * from pg_temp.ab_save('book',(select first_slot from ab_times));
grant select on ab_booked to public;
select is((select outcome from ab_booked),'booked','setter books through the existing engine');
select is((select outcome from pg_temp.ab_save('book',(select first_slot from ab_times))),'already_booked','retry cannot create another booking');
reset role;
select is((select count(*)::integer from public.appointments where lead_id='b6000000-0000-4000-8000-000000000201'),1,'only one appointment exists');
select is((select created_by from public.appointments where id=(select appointment_id from ab_booked)),
 'b6000000-0000-4000-8000-000000000101'::uuid,'setter attribution is retained');
select is((select status::text from public.tasks where id='b6000000-0000-4000-8000-000000000301'),'open','booking does not invent a call outcome');
select is((select count(*)::integer from public.setter_call_attempts where task_id='b6000000-0000-4000-8000-000000000301'),0,'booking does not invent a call attempt');
select is((select count(*)::integer from public.audit_log where action='setter_virtual_booked' and entity_id=(select appointment_id from ab_booked)),1,'one actor audit for actual booking');
select is((select count(*)::integer from public.domain_events where id=((select event from ab_booked)->>'id')::uuid),1,'existing booking event is durable');

set local role service_role;
select throws_ok($$select pg_temp.ab_save('reschedule',(select second_slot from ab_times),(select appointment_id from ab_booked),99)$$,
 '40001','Booking changed; reload available times','stale revision cannot overwrite a newer appointment');
select throws_ok($$select pg_temp.ab_save('reschedule',(select second_slot from ab_times),gen_random_uuid(),1)$$,
 '40001','Booking changed; reload available times','wrong appointment cannot be moved');
create temporary table ab_moved as select * from pg_temp.ab_save('reschedule',(select second_slot from ab_times),(select appointment_id from ab_booked),1);
grant select on ab_moved to public;
select is((select outcome from ab_moved),'rescheduled','setter moves the existing reservation');
select is((select revision from ab_moved),2::bigint,'moving bumps reminder revision');
select throws_ok($$select pg_temp.ab_save('reschedule',(select first_slot from ab_times),(select appointment_id from ab_booked),1)$$,
 '40001','Booking changed; reload available times','old screen cannot move a newer revision');
reset role;
select is((select count(*)::integer from public.audit_log where action='setter_virtual_rescheduled' and entity_id=(select appointment_id from ab_booked)),1,'reschedule actor is audited');

-- Authorization must be checked again after the server's external calendar call.
update public.tasks set claim_expires_at=now()-interval '1 second' where id='b6000000-0000-4000-8000-000000000301';
set local role service_role;
select throws_ok($$select pg_temp.ab_save('reschedule',(select first_slot from ab_times),(select appointment_id from ab_booked),2)$$,
 '40001','Claim expired or changed; reload the queue','expired claim cannot save loaded availability');
reset role;
update public.tasks set claim_expires_at=now()+interval '10 minutes' where id='b6000000-0000-4000-8000-000000000301';
update public.setter_queue_settings set enabled=false where company_id='b6000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.ab_save('reschedule',(select first_slot from ab_times),(select appointment_id from ab_booked),2)$$,
 '42501','Queue access required','paused queue cannot commit');
reset role;
update public.setter_queue_settings set enabled=true where company_id='b6000000-0000-4000-8000-000000000001';
update public.company_memberships set is_active=false where user_id='b6000000-0000-4000-8000-000000000101';
set local role service_role;
select throws_ok($$select pg_temp.ab_save('reschedule',(select first_slot from ab_times),(select appointment_id from ab_booked),2)$$,
 '42501','Queue access required','deactivated member cannot commit');
reset role;
select is((select scheduled_at from public.appointments where id=(select appointment_id from ab_booked)),(select second_slot from ab_times),'denied saves preserve the current appointment');
select * from finish();
rollback;
