begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public','sms_template_versions','approved templates are versioned');
select has_table('public','sms_delivery_jobs','delivery intents are durable');
insert into public.companies(id,name) values
 ('c1000000-0000-4000-8000-000000000001','Text Client A'),('c1000000-0000-4000-8000-000000000002','Text Client B');
insert into auth.users(id,email) values
 ('c1000000-0000-4000-8000-000000000101','approved-admin@example.com'),('c1000000-0000-4000-8000-000000000102','approved-setter@example.com'),('c1000000-0000-4000-8000-000000000103','approved-other@example.com');
insert into public.admin_profiles(id,company_id,display_name) values
 ('c1000000-0000-4000-8000-000000000101','c1000000-0000-4000-8000-000000000001','Client Admin'),
 ('c1000000-0000-4000-8000-000000000102','c1000000-0000-4000-8000-000000000001','Client Setter'),
 ('c1000000-0000-4000-8000-000000000103','c1000000-0000-4000-8000-000000000002','Other Admin');
update public.company_memberships set role='employee' where user_id='c1000000-0000-4000-8000-000000000102';
insert into public.leads(id,company_id,name,phone,phone_e164,email,submitted_address) values
 ('c1000000-0000-4000-8000-000000000201','c1000000-0000-4000-8000-000000000001','Dana Home','+16095550801','+16095550801','approved-home@example.com','1 Test Lane');
insert into public.lead_consents(company_id,lead_id,consent_type,granted,disclosure_version) values
 ('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','sms_contact',true,'test-explicit');
insert into public.company_sms_settings(company_id,messaging_service_sid,from_e164,enabled,quiet_start_hour,quiet_end_hour)
 values('c1000000-0000-4000-8000-000000000001','MG'||repeat('a',32),'+16095550899',true,0,0);
insert into public.setter_queue_settings(company_id,enabled) values('c1000000-0000-4000-8000-000000000001',true);
insert into public.company_setters(company_id,user_id,on_shift_until) values('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000102',now()+interval '1 hour');
insert into public.tasks(id,company_id,lead_id,title,queue_bucket,due_at) values
 ('c1000000-0000-4000-8000-000000000301','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','Call homeowner','call_request',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000101',true);
select throws_ok($$select public.save_sms_template_draft('first_touch','Hi {secret}, from {company_name}. Reply STOP.')$$,'22023','Check template fields, company identity and STOP wording','unknown fields cannot become approved copy');
create temporary table as_template as select public.save_sms_template_draft('first_touch','Hi {first_name}, from {company_name}. Can we call? Reply STOP to opt out.') id;
grant select on as_template to public;
select public.approve_sms_template((select id from as_template));
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000103',true);
select throws_ok($$select public.retire_sms_template((select id from as_template))$$,'42501','Template access required','other client cannot retire approved copy');
select is((select count(*)::integer from public.sms_template_versions),0,'other tenant cannot read template bodies');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000102',true);
select throws_ok($$select public.approve_sms_template((select id from as_template))$$,'42501','Company admin access required','setter cannot approve copy');
select public.set_setter_shift(true);
create temporary table as_claim as select public.claim_setter_task('c1000000-0000-4000-8000-000000000301') data;
grant select on as_claim to public;
create temporary table as_job as select public.queue_setter_template_sms('c1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from as_claim),(select id from as_template)) id;
grant select on as_job to public;
select is(public.queue_setter_template_sms('c1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from as_claim),(select id from as_template)),(select id from as_job),'refresh creates one deliberate text per claim');
select throws_ok($$select public.queue_setter_template_sms('c1000000-0000-4000-8000-000000000301',gen_random_uuid(),(select id from as_template))$$,'40001','Claim expired or changed; reload the queue','forged claim cannot queue a text');
reset role;
select throws_ok($$update public.sms_template_versions set body='Changed approved copy' where id=(select id from as_template)$$,'22023','Template versions are immutable','approved content cannot be rewritten');
select ok(not has_table_privilege('authenticated','public.sms_delivery_jobs','insert'),'browser cannot forge jobs');
select ok(not has_function_privilege('authenticated','public.claim_approved_sms_delivery(uuid,uuid)','execute'),'browser cannot claim network attempts');
select ok(not has_function_privilege('authenticated','public.start_approved_sms_delivery(uuid,uuid,uuid,text,text,text,text,integer)','execute'),'browser cannot bypass dispatch checks');
set local role service_role;
create temporary table as_prepared as select public.claim_approved_sms_delivery('c1000000-0000-4000-8000-000000000001',(select id from as_job)) data;
grant select on as_prepared to public;
select is(public.claim_approved_sms_delivery('c1000000-0000-4000-8000-000000000001',(select id from as_job)),null::jsonb,'a preparing lease cannot be claimed twice');
create temporary table as_started as select public.start_approved_sms_delivery((select id from as_job),(select (data->>'attempt_token')::uuid from as_prepared),(select id from as_template),'Hi Dana, from Text Client A. Can we call? Reply STOP to opt out.','+16095550801','+16095550899','MG'||repeat('a',32),1) data;
grant select on as_started to public;
select is((select (data->>'started')::boolean from as_started),true,'authorized approved text starts once');
select is((public.start_approved_sms_delivery((select id from as_job),(select (data->>'attempt_token')::uuid from as_prepared),(select id from as_template),'Hi Dana, from Text Client A. Can we call? Reply STOP to opt out.','+16095550801','+16095550899','MG'||repeat('a',32),1)->>'started')::boolean,false,'retry never starts another provider attempt');
select is(public.settle_approved_sms_delivery((select id from as_job),(select (data->>'attempt_token')::uuid from as_prepared),'unknown',null,null,'timeout'),'unknown','uncertain acceptance is explicit');
select is(public.claim_approved_sms_delivery('c1000000-0000-4000-8000-000000000001',(select id from as_job)),null::jsonb,'unknown acceptance never automatically retries');
select is(public.apply_approved_sms_callback('c1000000-0000-4000-8000-000000000002',(select id from as_job),(select (data->>'attempt_token')::uuid from as_prepared),'SM'||repeat('b',32),'delivered','+16095550801','+16095550899',null),false,'signed other-client callback cannot correlate a delivery');
select is(public.apply_approved_sms_callback('c1000000-0000-4000-8000-000000000001',(select id from as_job),(select (data->>'attempt_token')::uuid from as_prepared),'SM'||repeat('b',32),'delivered','+16095550801','+16095550899',null),true,'late callback resolves an uncertain send');
select is(public.settle_approved_sms_delivery((select id from as_job),(select (data->>'attempt_token')::uuid from as_prepared),'accepted','SM'||repeat('b',32),'queued',null),'accepted','late HTTP response preserves callback acceptance');
reset role;
select is((select count(*)::integer from public.sms_messages where approved_delivery_id=(select id from as_job)),1,'one conversation record per attempt');
select is((select status from public.sms_messages where approved_delivery_id=(select id from as_job)),'delivered','queued response cannot downgrade delivered callback');
select is((select count(*)::integer from public.setter_call_outcomes where task_id='c1000000-0000-4000-8000-000000000301'),0,'sending does not invent a call outcome');

-- A reply pauses automatic texts by company/phone and creates human work once.
insert into public.sms_messages(company_id,lead_id,direction,body,from_e164,to_e164,status,provider_sid) values
 ('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','inbound','Please call later','+16095550801','+16095550899','received','SM'||repeat('c',32)),
 ('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','inbound','Tomorrow works','+16095550801','+16095550899','received','SM'||repeat('d',32));
select is((select paused from public.sms_phone_pauses where company_id='c1000000-0000-4000-8000-000000000001' and phone_e164='+16095550801'),true,'reply pauses automation');
select is((select count(*)::integer from public.tasks where company_id='c1000000-0000-4000-8000-000000000001' and origin='sms_reply' and status='open'),1,'repeated replies create one pending review');
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000102',true);
select public.set_setter_sms_pause('c1000000-0000-4000-8000-000000000301',(select (data->>'claim_token')::uuid from as_claim),false);
reset role;
select is((select paused from public.sms_phone_pauses where company_id='c1000000-0000-4000-8000-000000000001' and phone_e164='+16095550801'),false,'authorized setter explicitly resumes');

-- Company-local quiet hours use the actual date across DST.
select is(private.next_sms_open('2026-11-01T05:30:00Z','America/New_York',21,8),'2026-11-01T13:00:00Z'::timestamptz,'fall-back night opens at 8 EST');
select is(private.next_sms_open('2027-03-14T06:30:00Z','America/New_York',21,8),'2027-03-14T12:00:00Z'::timestamptz,'spring-forward night opens at 8 EDT');
select is(private.next_sms_open('2026-11-02T14:00:00Z','America/Los_Angeles',21,8),'2026-11-02T16:00:00Z'::timestamptz,'another client timezone stays quiet until its own opening');
-- Approval and lifecycle scheduling start only on real new/revised bookings.
select public.save_booking_settings('c1000000-0000-4000-8000-000000000001',
 '{"isEnabled":true,"googleCalendarId":"approved@example.com","meetingDurationMinutes":30,"slotIntervalMinutes":30,"bufferMinutes":0,"minimumNoticeMinutes":0,"bookingHorizonDays":14,"concurrentCapacity":1}',
 (select jsonb_agg(jsonb_build_object('weekday',d,'startMinute',540,'endMinute',1020)) from generate_series(0,6) d),null);
create temporary table as_link as select link_id from public.ensure_booking_link('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','staff',null);
grant select on as_link to public;
insert into public.appointments(id,company_id,lead_id,scheduled_at,duration_minutes,status,meeting_type,booking_source,booking_link_id,calendar_sync_status)
 values('c1000000-0000-4000-8000-000000000401','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201',clock_timestamp()+interval '3 days',30,'scheduled','virtual','self_service',(select link_id from as_link),'pending');
select is((select count(*)::integer from public.sms_delivery_jobs where source='automatic'),0,'automatic texting starts off');
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000101',true);
select throws_ok($$select public.save_sms_automation_settings(true,'America/New_York')$$,'22023','Approve all appointment templates and configure the sender first','cannot enable without approved lifecycle copy');
do $$declare k text; tid uuid; begin
 foreach k in array array['booking_confirmation','booking_rescheduled','reminder_day','reminder_hour'] loop
   tid:=public.save_sms_template_draft(k,'Hi {first_name}, {company_name}: your inspection is {booking_time}. Manage: {booking_link}. Reply STOP to opt out.');
   perform public.approve_sms_template(tid);
 end loop;
end $$;
select public.save_sms_automation_settings(true,'America/New_York');
reset role;
select is((select count(*)::integer from public.sms_delivery_jobs where source='automatic'),0,'enabling does not backfill an old appointment');
update public.appointments set status='confirmed' where id='c1000000-0000-4000-8000-000000000401';
select is((select count(*)::integer from public.sms_delivery_jobs where source='automatic'),0,'status-only confirmation does not backfill a historical booking');
update public.appointments set revision=2,scheduled_at=scheduled_at+interval '1 hour' where id='c1000000-0000-4000-8000-000000000401';
select is((select count(*)::integer from public.sms_delivery_jobs where source='automatic'),3,'new revision schedules confirmation and two reminders');
update public.appointments set scheduled_at=scheduled_at where id='c1000000-0000-4000-8000-000000000401';
select is((select count(*)::integer from public.sms_delivery_jobs where source='automatic'),3,'duplicate appointment write creates no duplicate intents');
create temporary table as_auto as select id from public.sms_delivery_jobs where appointment_id='c1000000-0000-4000-8000-000000000401' and kind='booking_rescheduled';
grant select on as_auto to public;
create function pg_temp.try_auto() returns jsonb language plpgsql as $$
declare c jsonb; begin
 update public.sms_delivery_jobs set status='queued',attempt_token=null,not_before=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '2 hours' where id=(select id from as_auto);
 c:=public.claim_approved_sms_delivery('c1000000-0000-4000-8000-000000000001',(select id from as_auto));
 return public.start_approved_sms_delivery((select id from as_auto),(c->>'attempt_token')::uuid,(c->'template'->>'id')::uuid,
 'Text Client A: inspection tomorrow. Manage https://example.com/book. Reply STOP to opt out.','+16095550801','+16095550899','MG'||repeat('a',32),1);
end $$;
update public.lead_consents set granted=false where lead_id='c1000000-0000-4000-8000-000000000201' and consent_type='sms_contact';
select is(pg_temp.try_auto()->>'reason','no_consent','consent is rechecked immediately before dispatch');
update public.lead_consents set granted=true where lead_id='c1000000-0000-4000-8000-000000000201' and consent_type='sms_contact';
insert into public.suppression_list(company_id,channel,phone_e164,reason,source_system) values('c1000000-0000-4000-8000-000000000001','sms','+16095550801','STOP','test');
select is(pg_temp.try_auto()->>'reason','suppressed','STOP blocks an already queued reminder');
delete from public.suppression_list where company_id='c1000000-0000-4000-8000-000000000001' and source_system='test';
update public.sms_phone_pauses set paused=true where company_id='c1000000-0000-4000-8000-000000000001';
select is(pg_temp.try_auto()->>'reason','reply_or_manual_pause','takeover blocks automatic dispatch');
update public.sms_phone_pauses set paused=false where company_id='c1000000-0000-4000-8000-000000000001';
update public.leads set is_test=true where id='c1000000-0000-4000-8000-000000000201';
select is(pg_temp.try_auto()->>'reason','lead_ineligible','test leads never reach transport');
update public.leads set is_test=false where id='c1000000-0000-4000-8000-000000000201';
update public.company_sms_settings set enabled=false where company_id='c1000000-0000-4000-8000-000000000001';
select is(pg_temp.try_auto()->>'reason','sender_disabled','company outbound switch is rechecked');
update public.company_sms_settings set enabled=true,quiet_start_hour=extract(hour from clock_timestamp() at time zone 'America/New_York'),quiet_end_hour=(extract(hour from clock_timestamp() at time zone 'America/New_York')::integer+1)%24 where company_id='c1000000-0000-4000-8000-000000000001';
select is(pg_temp.try_auto()->>'reason','quiet_hours','current local quiet window defers delivery');
select ok((select not_before>clock_timestamp() and status='queued' from public.sms_delivery_jobs where id=(select id from as_auto)),'deferral remains queued until a real opening');
update public.company_sms_settings set quiet_start_hour=0,quiet_end_hour=0 where company_id='c1000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.sms_messages where direction='outbound'),1,'all blocked paths create no outgoing conversation record');
-- Move after preparation: the old intent is invalidated, never sent.
update public.sms_delivery_jobs set status='queued',not_before=clock_timestamp()-interval '1 second' where id=(select id from as_auto);
create temporary table as_stale as select public.claim_approved_sms_delivery('c1000000-0000-4000-8000-000000000001',(select id from as_auto)) data;
update public.appointments set revision=3,scheduled_at=scheduled_at+interval '1 hour' where id='c1000000-0000-4000-8000-000000000401';
select is((public.start_approved_sms_delivery((select id from as_auto),(select (data->>'attempt_token')::uuid from as_stale),(select (data->'template'->>'id')::uuid from as_stale),
 'Text Client A tomorrow. Reply STOP.','+16095550801','+16095550899','MG'||repeat('a',32),1)->>'started')::boolean,false,'reschedule cancels prepared messages for the old time');
select is((select count(*)::integer from public.sms_delivery_jobs where appointment_revision=3 and status='queued'),3,'reschedule creates only the new revision intents');
update public.appointments set status='no_show' where id='c1000000-0000-4000-8000-000000000401';
select is((select count(*)::integer from public.sms_delivery_jobs where appointment_id='c1000000-0000-4000-8000-000000000401' and status in ('queued','preparing')),0,'no-show closes remaining reminders');

-- An explicitly verified unknown outcome is audited and never resends.
insert into public.sms_delivery_jobs(id,company_id,lead_id,source,kind,appointment_id,appointment_revision,status,expires_at,attempt_token)
 values('c1000000-0000-4000-8000-000000000501','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','automatic','reminder_hour','c1000000-0000-4000-8000-000000000401',99,'unknown',clock_timestamp()+interval '1 hour',gen_random_uuid());
insert into public.sms_messages(company_id,lead_id,direction,body,from_e164,to_e164,status,approved_delivery_id)
 values('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','outbound','Text Client A reminder. Reply STOP.','+16095550899','+16095550801','unknown','c1000000-0000-4000-8000-000000000501');
update public.sms_delivery_jobs set message_id=(select id from public.sms_messages where approved_delivery_id='c1000000-0000-4000-8000-000000000501') where id='c1000000-0000-4000-8000-000000000501';
-- Many newer closed intents must never hide an unresolved attempt from admins.
insert into public.sms_delivery_jobs(company_id,lead_id,source,kind,appointment_id,appointment_revision,status,expires_at)
 select 'c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','automatic','reminder_day','c1000000-0000-4000-8000-000000000401',n,'skipped',clock_timestamp()+interval '1 hour' from generate_series(200,300) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000101',true);
select ok(exists(select 1 from jsonb_array_elements(public.get_sms_control_panel()->'deliveries') d where d->>'id'='c1000000-0000-4000-8000-000000000501'),'unresolved attempts remain accessible after 100 newer deliveries');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000103',true);
select throws_ok($$select public.resolve_sms_delivery('c1000000-0000-4000-8000-000000000501','not_sent',null,'Verified no matching request in Twilio logs')$$,'42501','Unknown delivery access required','operator cannot resolve another tenant');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000101',true);
select throws_ok($$select public.resolve_sms_delivery('c1000000-0000-4000-8000-000000000501','not_sent',null,'guess')$$,'22023','Verify Twilio logs and explain the resolution','resolution requires explicit evidence note');
select lives_ok($$select public.resolve_sms_delivery('c1000000-0000-4000-8000-000000000501','not_sent','','Verified no matching request in Twilio logs')$$,'an empty optional UI SID is treated as absent for a verified not-sent outcome');
reset role;
select is((select status from public.sms_delivery_jobs where id='c1000000-0000-4000-8000-000000000501'),'skipped','reconciliation records the verified outcome without requeue');
select is((select count(*)::integer from public.audit_log where entity_id='c1000000-0000-4000-8000-000000000501' and action='sms_delivery_operator_verified'),1,'operator attestation is auditable');
reset role;
insert into public.sms_delivery_jobs(id,company_id,lead_id,source,kind,appointment_id,appointment_revision,status,expires_at,attempt_token)
 values('c1000000-0000-4000-8000-000000000502','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000201','automatic','reminder_hour','c1000000-0000-4000-8000-000000000401',100,'preparing',clock_timestamp()+interval '1 hour','c1000000-0000-4000-8000-000000000602');
select is(public.settle_approved_sms_delivery('c1000000-0000-4000-8000-000000000502','c1000000-0000-4000-8000-000000000602','skipped',null,null,'booking_link_unavailable'),'skipped','preparation failures settle without a provider attempt');
select is((select count(*)::integer from public.sms_messages where approved_delivery_id='c1000000-0000-4000-8000-000000000502'),0,'preparation failure creates no outbound conversation');
select * from finish();
rollback;
