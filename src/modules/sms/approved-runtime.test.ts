// @vitest-environment node
import {afterEach,beforeEach,expect,test,vi} from "vitest";
const {rpc,send,buildUrl}=vi.hoisted(()=>({rpc:vi.fn(),send:vi.fn(),buildUrl:vi.fn()}));
vi.mock("@/lib/supabase/service",()=>({createServiceClient:()=>({rpc})}));
vi.mock("./client-config",()=>({isCompanySmsEnabled:(id:string)=>id==="c1000000-0000-4000-8000-000000000001",sendCompanySms:send}));
vi.mock("@/modules/booking/booking-runtime",()=>({buildBookingUrl:buildUrl}));
import {approvedSmsReady,createApprovedSmsDependencies,smsCallbackBase} from "./approved-runtime";
import type {ApprovedSmsJob} from "./approved-schema";
const companyId="c1000000-0000-4000-8000-000000000001";
const job:ApprovedSmsJob={id:"c1000000-0000-4000-8000-000000000501",company_id:companyId,lead_id:"c1000000-0000-4000-8000-000000000201",source:"automatic",kind:"booking_confirmation",attempt_token:"c1000000-0000-4000-8000-000000000601",template:null,first_name:"Dana",company_name:"Client",to_e164:"+16095550101",from_e164:"+16095550199",messaging_service_sid:`MG${"a".repeat(32)}`,booking_link_id:"c1000000-0000-4000-8000-000000000801",scheduled_at:"2026-11-06T15:00:00Z",timezone:"America/New_York"};
beforeEach(()=>{vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL","piw.example");vi.stubEnv("SMS_AUTOMATION_ENABLED","true");rpc.mockReset().mockResolvedValue({data:null,error:null});send.mockReset().mockResolvedValue({sid:`SM${"b".repeat(32)}`,status:"queued"});});
afterEach(()=>vi.unstubAllEnvs());
test.each(["","http://piw.example","piw.example/path","https://user:secret@piw.example","localhost"])("invalid canonical host %s disables only approved texting",host=>{vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL",host);expect(smsCallbackBase()).toBeNull();expect(approvedSmsReady(companyId)).toBe(false);});
test("canonical host and company readiness are both required",()=>{expect(approvedSmsReady(companyId)).toBe(true);expect(approvedSmsReady("other-company")).toBe(false);});
test("runtime sends through selected company with exact sender and attempt-correlated callback",async()=>{
 await createApprovedSmsDependencies().send(job,"approved body");
 expect(send).toHaveBeenCalledWith(companyId,{from:job.from_e164,to:job.to_e164,messagingServiceSid:job.messaging_service_sid,body:"approved body",statusCallback:`https://piw.example/api/twilio/sms/status?delivery=${job.id}&attempt=${job.attempt_token}`});
});
test("malformed claim JSON fails before transport",async()=>{rpc.mockResolvedValue({data:{company_id:companyId},error:null});await expect(createApprovedSmsDependencies().claim(companyId)).rejects.toThrow();expect(send).not.toHaveBeenCalled();});
