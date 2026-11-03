begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();
-- CI port; copy with the isolated project's port before local execution.
select extensions.dblink_connect('sms_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('sms_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('sms_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('sms_gate',$$
 insert into public.companies(id,name) values('c3000000-0000-4000-8000-000000000001','SMS race');
 insert into auth.users(id,email) values('c3000000-0000-4000-8000-000000000101','sms-race@example.com');
 insert into public.admin_profiles(id,company_id,display_name) values('c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000001','SMS setter');
 insert into public.setter_queue_settings(company_id,enabled) values('c3000000-0000-4000-8000-000000000001',true);
 insert into public.company_setters(company_id,user_id,on_shift_until) values('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000101',now()+interval '1 hour');
 insert into public.leads(id,company_id,name,phone,email,submitted_address) values('c3000000-0000-4000-8000-000000000201','c3000000-0000-4000-8000-000000000001','Homeowner','+16095550901','sms-race-home@example.com','1 SMS Lane');
 insert into public.lead_consents(company_id,lead_id,consent_type,granted,disclosure_version) values('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000201','sms_contact',true,'test');
 insert into public.company_sms_settings(company_id,messaging_service_sid,from_e164,enabled,quiet_start_hour,quiet_end_hour) values('c3000000-0000-4000-8000-000000000001','MG'||repeat('f',32),'+16095550999',true,0,0);
 insert into public.sms_template_versions(id,company_id,kind,version,body,status,created_by,approved_by,approved_at)
 values('c3000000-0000-4000-8000-000000000501','c3000000-0000-4000-8000-000000000001','first_touch',1,'Hi from {company_name}. Reply STOP.','approved','c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000101',now());
 insert into public.tasks(id,company_id,lead_id,title,queue_bucket,claim_user_id,claim_token,claim_expires_at)
 values('c3000000-0000-4000-8000-000000000301','c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000201','SMS race','call_request','c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000401',now()+interval '15 minutes');
 insert into public.sms_delivery_jobs(id,company_id,lead_id,source,kind,task_id,task_claim_token,actor_id,requested_template_id,expires_at)
 values('c3000000-0000-4000-8000-000000000601','c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000201','manual','first_touch','c3000000-0000-4000-8000-000000000301','c3000000-0000-4000-8000-000000000401','c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000501',now()+interval '15 minutes');
$$);
select extensions.dblink_send_query('sms_a',$$select public.claim_approved_sms_delivery('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000601')$$);
select extensions.dblink_send_query('sms_b',$$select public.claim_approved_sms_delivery('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000601')$$);
create temporary table sms_claims as select * from extensions.dblink_get_result('sms_a') as r(data jsonb);
insert into sms_claims select * from extensions.dblink_get_result('sms_b') as r(data jsonb);
select is((select count(*)::integer from sms_claims where data is not null),1,'two workers get only one preparing lease');
select extensions.dblink_disconnect('sms_a');
select extensions.dblink_disconnect('sms_b');
select extensions.dblink_connect('sms_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('sms_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('sms_gate','begin');
select extensions.dblink_exec('sms_gate',$$do $b$ begin perform pg_advisory_xact_lock(hashtextextended('sms-phone:c3000000-0000-4000-8000-000000000001:+16095550901',0)); end $b$;$$);
select extensions.dblink_send_query('sms_a',format($q$select public.start_approved_sms_delivery('c3000000-0000-4000-8000-000000000601',%L::uuid,'c3000000-0000-4000-8000-000000000501','Hi from SMS race. Reply STOP.','+16095550901','+16095550999','MG'||repeat('f',32),1)$q$,(select data->>'attempt_token' from sms_claims where data is not null)));
select extensions.dblink_send_query('sms_b',format($q$select public.start_approved_sms_delivery('c3000000-0000-4000-8000-000000000601',%L::uuid,'c3000000-0000-4000-8000-000000000501','Hi from SMS race. Reply STOP.','+16095550901','+16095550999','MG'||repeat('f',32),1)$q$,(select data->>'attempt_token' from sms_claims where data is not null)));
select pg_sleep(0.2);
select extensions.dblink_exec('sms_gate','commit');
create temporary table sms_starts as select * from extensions.dblink_get_result('sms_a') as r(data jsonb);
insert into sms_starts select * from extensions.dblink_get_result('sms_b') as r(data jsonb);
select is((select count(*)::integer from sms_starts where (data->>'started')::boolean),1,'competing starts authorize only one network attempt');
select is((select count(*)::integer from public.sms_messages where company_id='c3000000-0000-4000-8000-000000000001'),1,'the attempt has one conversation record');
select * from extensions.dblink('sms_gate',format($q$select public.settle_approved_sms_delivery('c3000000-0000-4000-8000-000000000601',%L::uuid,'accepted','SM'||repeat('f',32),'queued',null)$q$,(select data->>'attempt_token' from sms_claims where data is not null))) as r(status text);
select extensions.dblink_disconnect('sms_a');
select extensions.dblink_disconnect('sms_b');
-- The claim may expire while a start waits for phone serialization.
select extensions.dblink_exec('sms_gate',$$
 update public.tasks set claim_token='c3000000-0000-4000-8000-000000000402',claim_expires_at=clock_timestamp()+interval '1 second' where id='c3000000-0000-4000-8000-000000000301';
 insert into public.sms_delivery_jobs(id,company_id,lead_id,source,kind,task_id,task_claim_token,actor_id,requested_template_id,expires_at)
 values('c3000000-0000-4000-8000-000000000602','c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000201','manual','first_touch','c3000000-0000-4000-8000-000000000301','c3000000-0000-4000-8000-000000000402','c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000501',now()+interval '15 minutes');
$$);
create temporary table sms_expiry as select * from extensions.dblink('sms_gate',$$select public.claim_approved_sms_delivery('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000602')$$) as r(data jsonb);
select extensions.dblink_connect('sms_expiry','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('sms_gate','begin');
select extensions.dblink_exec('sms_gate',$$do $b$ begin perform pg_advisory_xact_lock(hashtextextended('sms-phone:c3000000-0000-4000-8000-000000000001:+16095550901',0)); end $b$;$$);
select extensions.dblink_send_query('sms_expiry',format($q$select public.start_approved_sms_delivery('c3000000-0000-4000-8000-000000000602',%L::uuid,'c3000000-0000-4000-8000-000000000501','Hi from SMS race. Reply STOP.','+16095550901','+16095550999','MG'||repeat('f',32),1)$q$,(select data->>'attempt_token' from sms_expiry)));
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('sms_expiry'),1,'manual intent starts valid and waits for the phone lock');
select pg_sleep(1.1);
select extensions.dblink_exec('sms_gate','commit');
create temporary table sms_expiry_result as select * from extensions.dblink_get_result('sms_expiry') as r(data jsonb);
select is((select (data->>'started')::boolean from sms_expiry_result),false,'a claim that expired during the lock wait cannot authorize a send');
select is((select count(*)::integer from public.sms_messages where company_id='c3000000-0000-4000-8000-000000000001'),1,'expiry does not create an outgoing conversation record');
select extensions.dblink_disconnect('sms_expiry');
-- Consent can be withdrawn while an approved template row is locked.
select extensions.dblink_exec('sms_gate',$$
 update public.tasks set claim_token='c3000000-0000-4000-8000-000000000403',claim_expires_at=clock_timestamp()+interval '15 minutes' where id='c3000000-0000-4000-8000-000000000301';
 insert into public.sms_delivery_jobs(id,company_id,lead_id,source,kind,task_id,task_claim_token,actor_id,requested_template_id,expires_at)
 values('c3000000-0000-4000-8000-000000000603','c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000201','manual','first_touch','c3000000-0000-4000-8000-000000000301','c3000000-0000-4000-8000-000000000403','c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000501',now()+interval '15 minutes');
$$);
create temporary table sms_consent as select * from extensions.dblink('sms_gate',$$select public.claim_approved_sms_delivery('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000603')$$) as r(data jsonb);
select extensions.dblink_connect('sms_consent','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('sms_gate','begin');
select extensions.dblink_exec('sms_gate',$$do $b$ begin perform 1 from public.sms_template_versions where id='c3000000-0000-4000-8000-000000000501' for update; end $b$;$$);
select extensions.dblink_send_query('sms_consent',format($q$select public.start_approved_sms_delivery('c3000000-0000-4000-8000-000000000603',%L::uuid,'c3000000-0000-4000-8000-000000000501','Hi from SMS race. Reply STOP.','+16095550901','+16095550999','MG'||repeat('f',32),1)$q$,(select data->>'attempt_token' from sms_consent)));
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('sms_consent'),1,'start passes entry checks then waits on template');
select extensions.dblink_exec('sms_gate',$$update public.lead_consents set granted=false where lead_id='c3000000-0000-4000-8000-000000000201' and consent_type='sms_contact'$$);
select extensions.dblink_exec('sms_gate','commit');
create temporary table sms_consent_result as select * from extensions.dblink_get_result('sms_consent') as r(data jsonb);
select is((select data->>'reason' from sms_consent_result),'no_consent','consent revoked during preparation blocks dispatch');
select extensions.dblink_disconnect('sms_consent');
select * from extensions.dblink('sms_gate',format($q$select public.settle_approved_sms_delivery('c3000000-0000-4000-8000-000000000603',%L::uuid,'rejected',null,null,'test_cleanup')$q$,(select data->>'attempt_token' from sms_consent))) as r(status text);
-- A destination changing while the phone lock is held cannot retain the old To.
select extensions.dblink_exec('sms_gate',$$
 update public.lead_consents set granted=true where lead_id='c3000000-0000-4000-8000-000000000201' and consent_type='sms_contact';
 update public.tasks set claim_token='c3000000-0000-4000-8000-000000000404',claim_expires_at=clock_timestamp()+interval '15 minutes' where id='c3000000-0000-4000-8000-000000000301';
 insert into public.sms_delivery_jobs(id,company_id,lead_id,source,kind,task_id,task_claim_token,actor_id,requested_template_id,expires_at)
 values('c3000000-0000-4000-8000-000000000604','c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000201','manual','first_touch','c3000000-0000-4000-8000-000000000301','c3000000-0000-4000-8000-000000000404','c3000000-0000-4000-8000-000000000101','c3000000-0000-4000-8000-000000000501',now()+interval '15 minutes');
$$);
create temporary table sms_phone as select * from extensions.dblink('sms_gate',$$select public.claim_approved_sms_delivery('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000604')$$) as r(data jsonb);
select extensions.dblink_connect('sms_phone','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('sms_gate','begin');
select extensions.dblink_exec('sms_gate',$$do $b$ begin perform pg_advisory_xact_lock(hashtextextended('sms-phone:c3000000-0000-4000-8000-000000000001:+16095550901',0)); end $b$;$$);
select extensions.dblink_send_query('sms_phone',format($q$select public.start_approved_sms_delivery('c3000000-0000-4000-8000-000000000604',%L::uuid,'c3000000-0000-4000-8000-000000000501','Hi from SMS race. Reply STOP.','+16095550901','+16095550999','MG'||repeat('f',32),1)$q$,(select data->>'attempt_token' from sms_phone)));
select pg_sleep(0.2);
select extensions.dblink_exec('sms_gate',$$update public.leads set phone='+16095550902',phone_e164='+16095550902' where id='c3000000-0000-4000-8000-000000000201'$$);
select extensions.dblink_exec('sms_gate','commit');
create temporary table sms_phone_result as select * from extensions.dblink_get_result('sms_phone') as r(data jsonb);
select is((select data->>'reason' from sms_phone_result),'recipient_or_sender_changed','changed phone after preparation cannot send to the old destination');
select extensions.dblink_disconnect('sms_phone');
select extensions.dblink_exec('sms_gate',$$
 delete from public.audit_log where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.sms_delivery_jobs where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.sms_messages where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.tasks where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.leads where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.company_setters where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.sms_template_versions where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.admin_profiles where company_id='c3000000-0000-4000-8000-000000000001';
 delete from public.company_memberships where company_id='c3000000-0000-4000-8000-000000000001';
 delete from auth.users where id='c3000000-0000-4000-8000-000000000101';
 delete from public.companies where id='c3000000-0000-4000-8000-000000000001';
$$);
select extensions.dblink_disconnect('sms_gate');
select * from finish();
rollback;
