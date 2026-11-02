// @vitest-environment node
import {describe,expect,test} from "vitest";
import {SmsProviderError} from "./twilio";
import {processApprovedSmsDelivery,type ApprovedDeliveryDependencies} from "./approved-delivery";
import type {ApprovedSmsJob} from "./approved-schema";
const companyId="c1000000-0000-4000-8000-000000000001";
const job:ApprovedSmsJob={id:"c1000000-0000-4000-8000-000000000501",company_id:companyId,lead_id:"c1000000-0000-4000-8000-000000000201",source:"automatic",kind:"booking_confirmation",attempt_token:"c1000000-0000-4000-8000-000000000601",
 template:{id:"c1000000-0000-4000-8000-000000000701",version:1,body:"Hi {first_name}, {company_name}: {booking_time}. Manage {booking_link}. Reply STOP."},first_name:"Dana",company_name:"Text Client A",to_e164:"+16095550801",from_e164:"+16095550899",messaging_service_sid:`MG${"a".repeat(32)}`,booking_link_id:"c1000000-0000-4000-8000-000000000801",scheduled_at:"2026-11-06T15:00:00.000Z",timezone:"America/New_York"};
function fixture() {
 const f={status:"queued",calls:[] as Array<{companyId:string;body:string;from:string}>,starts:0,claims:0,block:null as string|null,current:structuredClone(job),failSettlement:false};
 const dependencies:ApprovedDeliveryDependencies={
   ready:()=>true,automationEnabled:true,
   async claim(){f.claims++;if(f.status!=="queued")return null;f.status="preparing";return f.current;},
   async start(){f.starts++;if(f.block){f.status="skipped";return {started:false,reason:f.block};}f.status="sending";return {started:true};},
   async settle(_job,outcome){if(f.failSettlement)throw new Error("database unavailable");if(f.status==="accepted")return "accepted";f.status=outcome==="rejected"?"failed":outcome==="skipped"?"skipped":outcome;return f.status;},
   async manageUrl(){return "https://client.example/book/signed-token";},
   async send(j,body){f.calls.push({companyId:j.company_id,body,from:j.from_e164!});return {sid:`SM${"b".repeat(32)}`,status:"queued"};},
 };
 return {f,dependencies};
}
describe("approved SMS delivery",()=>{
 test("renders only approved company content using the appointment timezone",async()=>{
   const {f,dependencies}=fixture();
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"accepted"});
   expect(f.calls).toEqual([{companyId,from:"+16095550899",body:"Hi Dana, Text Client A: Friday, November 6 at 10:00 AM EST. Manage https://client.example/book/signed-token. Reply STOP."}]);
 });
 test("disabled readiness does not reserve or send",async()=>{
   const {f,dependencies}=fixture();dependencies.ready=()=>false;
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"disabled"});
   expect(f.claims).toBe(0);expect(f.calls).toEqual([]);
 });
 test.each(["suppressed","no_consent","claim_changed","reply_or_manual_pause","stale_appointment","template_not_approved","quiet_hours"])("send-time block %s never reaches Twilio",async(reason)=>{
   const {f,dependencies}=fixture();f.block=reason;
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"blocked",reason});
   expect(f.calls).toEqual([]);
 });
 test("a network timeout is unknown and retry cannot make a second POST",async()=>{
   const {f,dependencies}=fixture();dependencies.send=async(j,body)=>{f.calls.push({companyId:j.company_id,body,from:j.from_e164!});throw new SmsProviderError("timeout");};
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"unknown"});
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"idle"});
   expect(f.calls).toHaveLength(1);
 });
 test("definitely rejected requests are failed without retrying",async()=>{
   const {f,dependencies}=fixture();dependencies.send=async()=>{throw new SmsProviderError("rejected","21610","rejected");};
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"failed"});
   expect(f.status).toBe("failed");
 });
 test("a lost database settlement after acceptance never repeats the send",async()=>{
   const {f,dependencies}=fixture();f.failSettlement=true;
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"unknown"});
   expect(f.status).toBe("sending");
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"idle"});
   expect(f.calls).toHaveLength(1);
 });
 test("an early accepted callback wins over a subsequent transport timeout",async()=>{
   const {f,dependencies}=fixture();dependencies.send=async()=>{f.status="accepted";throw new SmsProviderError("timeout");};
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"accepted"});
   expect(f.status).toBe("accepted");
 });
 test("missing manage link skips preparation without starting a POST",async()=>{
   const {f,dependencies}=fixture();dependencies.manageUrl=async()=>null;
   expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"skipped",reason:"booking_link_unavailable"});
   expect(f.starts).toBe(0);expect(f.calls).toEqual([]);
 });
 test("unknown fields and oversized rendered bodies do not start a send",async()=>{
   for(const body of ["Hi {unknown}","a".repeat(1000)]) {
     const {f,dependencies}=fixture();f.current.template!.body=body;
     expect(await processApprovedSmsDelivery({companyId},dependencies)).toMatchObject({outcome:"skipped"});
     expect(f.starts).toBe(0);expect(f.calls).toEqual([]);
   }
 });
 test("a mismatched company context cannot send through the selected client",async()=>{
   const {f,dependencies}=fixture();f.current.company_id="c1000000-0000-4000-8000-000000000002";
   await expect(processApprovedSmsDelivery({companyId},dependencies)).rejects.toThrow("SMS delivery company mismatch");
   expect(f.calls).toEqual([]);expect(f.starts).toBe(0);
 });
});
