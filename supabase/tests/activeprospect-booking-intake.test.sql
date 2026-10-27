begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.companies(id, name) values
('a1000000-0000-4000-8000-000000000001', 'AP Client A'),
('a1000000-0000-4000-8000-000000000002', 'AP Client B');

create function pg_temp.ap_payload(v_id text, v_phone text default '+16095550101', v_test boolean default false)
returns jsonb language sql as $$
 select jsonb_build_object('schema_version',1,'lead_id',v_id,'flow_id','flow-a','submitted_at','2026-10-27T14:00:00Z','is_test',v_test,
 'source',jsonb_build_object('id','vendor-a','name','Vendor A'),
 'lead',jsonb_build_object('name','Dana','phone',v_phone,'email','dana@example.com','submitted_address','1 Test Lane'));
$$;

select has_table('public','activeprospect_intake_receipts','durable intake receipts exist');
select has_table('public','booking_contact_ownership','contact ownership exists');
select ok(not has_function_privilege('anon','public.accept_activeprospect_booking_intake(uuid,text,text,text,jsonb)','EXECUTE'),'anon cannot submit arbitrary tenant intake');
select ok(not has_function_privilege('authenticated','public.accept_activeprospect_booking_intake(uuid,text,text,text,jsonb)','EXECUTE'),'members cannot bypass server bindings');

create temporary table result_a as select * from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('vendor-1'));
select is((select state from result_a),'accepted','PIW-owned complete lead is accepted');
select is((select count(*)::integer from public.leads where company_id='a1000000-0000-4000-8000-000000000001'),1,'one canonical lead graph');
select is((select count(*)::integer from public.tasks where company_id='a1000000-0000-4000-8000-000000000001'),1,'one immediate setter task');
select is((select count(*)::integer from public.domain_events where company_id='a1000000-0000-4000-8000-000000000001'),1,'one CRM event');
select is((select count(*)::integer from public.event_outbox o join public.domain_events e on e.id=o.event_id where e.company_id='a1000000-0000-4000-8000-000000000001'),1,'one durable outbox event');
select is((select granted from public.lead_consents where lead_id=(select lead_id from result_a) and consent_type='sms_contact'),false,'missing evidence never grants SMS');
select is((select appointment_type from public.activeprospect_intake_receipts where id=(select receipt_id from result_a)),'virtual','flow booking type is retained');
select is((select contact_owner from public.booking_contact_ownership where company_id='a1000000-0000-4000-8000-000000000001' and phone_e164='+16095550101'),'piw','PIW explicitly owns this phone');

create temporary table replay_a as select * from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('vendor-1'));
select is((select receipt_id from replay_a),(select receipt_id from result_a),'retry returns original receipt');
select is((select duplicate from replay_a),true,'retry is identified as duplicate');
select is((select count(*)::integer from public.tasks where company_id='a1000000-0000-4000-8000-000000000001'),1,'retry creates no additional task');
select throws_ok($$select * from public.accept_activeprospect_booking_intake('a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('vendor-1','+16095550199'))$$,'22000','ActiveProspect replay conflict','changed replay cannot overwrite original evidence');

create temporary table same_phone as select * from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-b','in_home','piw',jsonb_set(pg_temp.ap_payload('vendor-2'),'{flow_id}','"flow-b"'));
select is((select lead_id from same_phone),(select lead_id from result_a),'same tenant phone across flows links to existing lead');
select is((select count(*)::integer from public.tasks where company_id='a1000000-0000-4000-8000-000000000001'),1,'new source submission does not restart contact');

select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000002','flow-a','in_home','piw',pg_temp.ap_payload('vendor-1'))),'accepted','same identity in another tenant is independent');
select is((select count(*)::integer from public.leads where company_id='a1000000-0000-4000-8000-000000000002'),1,'second tenant gets its own lead');

select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','external',pg_temp.ap_payload('external-1','+16095550103'))),'external','external-owned traffic is receipt-only');
select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('external-2','+16095550103'))),'ownership_conflict','new flow cannot silently take an externally owned contact');
select is((select count(*)::integer from public.leads where company_id='a1000000-0000-4000-8000-000000000001'),1,'external and conflicted receipts create no live leads');

select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('test-1','+16095550104',true))),'test','synthetic submission is receipt-only');
select is((select count(*)::integer from public.booking_contact_ownership where phone_e164='+16095550104'),0,'test traffic reserves no contact ownership');
select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('incomplete-1','+16095550105') #- '{lead,email}')),'needs_review','missing email is retained for review');
select is((select count(*)::integer from public.leads where company_id='a1000000-0000-4000-8000-000000000001'),1,'incomplete submissions create no invented lead data');

create temporary table with_consent as select * from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('consented-1','+16095550106') || jsonb_build_object('sms_consent',jsonb_build_object(
 'granted',true,'company_id','a1000000-0000-4000-8000-000000000001','disclosure','I agree to texts from AP Client A','captured_at','2026-10-27T13:59:00Z','evidence_url','https://cert.trustedform.com/example')));
select is((select granted from public.lead_consents where lead_id=(select lead_id from with_consent) and consent_type='sms_contact'),true,'complete tenant-specific evidence grants SMS eligibility');

select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('unproven-1','+16095550107') || '{"sms_consent":{"granted":true,"evidence_url":"https://cert.trustedform.com/example"}}'::jsonb)),'accepted','unproven SMS consent does not prevent call-only intake');
select is((select granted from public.lead_consents c join public.leads l on l.id=c.lead_id where l.phone_e164='+16095550107' and c.consent_type='sms_contact'),false,'certificate alone never grants SMS');
select throws_ok($$select * from public.accept_activeprospect_booking_intake('a1000000-0000-4000-8000-000000000001','other-flow','virtual','piw',pg_temp.ap_payload('mismatch'))$$,'22023','Invalid ActiveProspect intake','database rejects flow mismatch too');
create temporary table existing_piw as select * from public.submit_lead_intake_from_source(
 'a1000000-0000-4000-8000-000000000001','Existing','+16095550180','existing@example.com','80 Test Lane',null,
 'a1000000-0000-4000-8000-000000000180',1,'piw_intake','existing-site-lead',null,null,null,null,null,null,false,'+16095550180','existing@example.com');
select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('site-return','+16095550180'))),'linked','a returning PIW contact does not create another graph');
select is((select count(*)::integer from public.leads where company_id='a1000000-0000-4000-8000-000000000001' and phone_e164='+16095550180'),1,'existing site contact is not duplicated');
select is((select count(*)::integer from public.tasks where lead_id=(select lead_id from existing_piw)),0,'returning site lead does not restart initial contact');

select throws_ok($$select * from public.accept_activeprospect_booking_intake('a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('rollback-1','+16095550181') || '{"sms_consent":{"granted":true,"company_id":"a1000000-0000-4000-8000-000000000001","disclosure":"Agree","evidence_url":"https://example.com/evidence","captured_at":"bad-time"}}')$$,'22007',null,'late persistence failure rolls back the whole statement');
select is((select count(*)::integer from public.leads where phone_e164='+16095550181'),0,'failed transaction leaves no orphan lead');
select is((select count(*)::integer from public.booking_contact_ownership where phone_e164='+16095550181'),0,'failed transaction leaves no ownership claim');

insert into auth.users(id,email) values ('a1000000-0000-4000-8000-000000000101','ap-manager@example.test');
create temporary table manual_piw as select * from public.submit_lead_intake(
 'a1000000-0000-4000-8000-000000000001','Manual contact','(609) 555-0182','manual@example.com','82 Test Lane',null,
 'a1000000-0000-4000-8000-000000000182',1);
select is((select state from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('manual-return','+16095550182'))),'linked','legacy manual contact with no phone_e164 is reused');
select is((select count(*)::integer from public.tasks where lead_id=(select lead_id from manual_piw)),0,'manual returning contact gets no new initial task');
select public.grant_company_membership('ap-manager@example.test','a1000000-0000-4000-8000-000000000001','manager','AP Manager');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000101","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.activeprospect_intake_receipts where company_id='a1000000-0000-4000-8000-000000000002'),0,'manager cannot see another tenant receipt');
select ok((select count(*) from public.activeprospect_intake_receipts)>0,'manager can see own company receipts');
select is((select count(*)::integer from public.booking_contact_ownership where company_id='a1000000-0000-4000-8000-000000000002'),0,'manager cannot see another tenant contact ownership');
reset role;
insert into auth.users(id,email) values ('a1000000-0000-4000-8000-000000000102','ap-employee@example.test');
select public.grant_company_membership('ap-employee@example.test','a1000000-0000-4000-8000-000000000001','employee','AP Employee');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000102","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.activeprospect_intake_receipts),0,'non-manager cannot read receipt evidence');
select is((select count(*)::integer from public.booking_contact_ownership),0,'non-manager cannot read ownership');
reset role;

insert into public.suppression_list(company_id,channel,phone_e164,reason,source_system)
 values ('a1000000-0000-4000-8000-000000000001','sms','+16095550188','STOP','twilio_sms');
select * from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('suppressed-1','+16095550188') || jsonb_build_object('sms_consent',jsonb_build_object(
 'granted',true,'company_id','a1000000-0000-4000-8000-000000000001','disclosure','Agree','captured_at','2026-10-27T13:59:00Z','evidence_url','https://example.com/evidence')));
select is((select count(*)::integer from public.suppression_list where company_id='a1000000-0000-4000-8000-000000000001' and phone_e164='+16095550188'),1,'consented intake never removes prior suppression');

select * from public.accept_activeprospect_booking_intake(
 'a1000000-0000-4000-8000-000000000001','flow-a','virtual','piw',pg_temp.ap_payload('future-consent','+16095550189') || jsonb_build_object('sms_consent',jsonb_build_object(
 'granted',true,'company_id','a1000000-0000-4000-8000-000000000001','disclosure','Agree','captured_at','2099-10-27T13:59:00Z','evidence_url','https://example.com/evidence')));
select is((select granted from public.lead_consents c join public.leads l on l.id=c.lead_id where l.phone_e164='+16095550189' and c.consent_type='sms_contact'),false,'future consent timestamps do not grant SMS');

select * from finish();
rollback;
