// @vitest-environment node
import {afterEach,beforeEach,describe,expect,test,vi} from "vitest";
import {setterTaskId,setterClaimToken} from "@/test/setter-queue-fixture";
const state=vi.hoisted(()=>({signedIn:true,configured:true,error:null as null|{message:string},contextCalls:0,serviceCalls:0}));
const load=vi.hoisted(()=>vi.fn());
const create=vi.hoisted(()=>vi.fn(()=>({})));
vi.mock("next/cache",()=>({revalidatePath:()=>{}}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({"x-forwarded-for":"203.0.113.61"})}));
vi.mock("@/lib/supabase/server",()=>({createServerClient:async()=>({
  auth:{getUser:async()=>({data:{user:state.signedIn?{id:"b6000000-0000-4000-8000-000000000101"}:null}})},
  rpc:async()=>{state.contextCalls++;return {error:state.error,data:[{company_id:"b6000000-0000-4000-8000-000000000001",lead_id:"b6000000-0000-4000-8000-000000000201",link_id:"b6000000-0000-4000-8000-000000000501"}]};},
})}));
vi.mock("@/lib/supabase/service",()=>({createServiceClient:()=>{state.serviceCalls++;return {};}}));
vi.mock("@/modules/booking/booking-runtime",()=>({resolveBookingConfiguration:()=>state.configured?{signingSecret:"at-least-thirty-two-bytes-for-test-secret"}:null}));
vi.mock("@/modules/booking/setter-booking-runtime",()=>({createSetterBookingDependencies:create,loadSetterBookingAvailability:load}));
import {runSetterBookingAction} from "./booking-actions";
function form(data:Record<string,string>={}) {const f=new FormData();for(const [k,v] of Object.entries({action:"load",taskId:setterTaskId,token:setterClaimToken,...data}))f.set(k,v);return f;}
beforeEach(()=>{
  state.signedIn=true;state.configured=true;state.error=null;state.contextCalls=0;state.serviceCalls=0;create.mockClear();load.mockReset();
  load.mockResolvedValue({model:{kind:"open",firstName:"Dana",inviteEmail:"d•••@example.com",days:[],booking:null,timezone:"America/New_York",meetingTitle:"Video inspection",durationMinutes:30,supportPhone:null},revision:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe("setter booking action boundary",()=>{
  test("unauthenticated caller never reaches privileged booking",async()=>{
    state.signedIn=false;
    expect((await runSetterBookingAction(form())).ok).toBe(false);
    expect(state.serviceCalls).toBe(0);expect(state.contextCalls).toBe(0);
  });
  test.each([{companyId:"b6000000-0000-4000-8000-000000000002"},{leadId:"b6000000-0000-4000-8000-000000000203"},{linkId:"b6000000-0000-4000-8000-000000000502"}] as Record<string,string>[])("rejects browser-selected identity %j",async(extra)=>{
    expect((await runSetterBookingAction(form(extra))).ok).toBe(false);
    expect(state.serviceCalls).toBe(0);expect(state.contextCalls).toBe(0);
  });
  test("missing setup returns an actionable state without privileged reads",async()=>{
    state.configured=false;
    expect(await runSetterBookingAction(form())).toMatchObject({ok:false,code:"unavailable"});
    expect(state.serviceCalls).toBe(0);
  });
  test("a stale claim cannot list another homeowner's availability",async()=>{
    state.error={message:"Claim expired or changed; reload the queue"};
    expect(await runSetterBookingAction(form())).toMatchObject({ok:false,code:"claim_changed"});
    expect(state.serviceCalls).toBe(0);
  });
  test("context comes from the authenticated RPC and the result contains no capability",async()=>{
    const result=await runSetterBookingAction(form());
    expect(result).toMatchObject({ok:true,availability:{model:{firstName:"Dana"}}});
    expect(create).toHaveBeenCalledWith(expect.anything(),expect.anything(),{
      companyId:"b6000000-0000-4000-8000-000000000001",leadId:"b6000000-0000-4000-8000-000000000201",linkId:"b6000000-0000-4000-8000-000000000501",
      userId:"b6000000-0000-4000-8000-000000000101",taskId:setterTaskId,claimToken:setterClaimToken,
    },undefined);
    expect(JSON.stringify(result)).not.toContain("b6000000-0000-4000-8000-000000000501");
  });
  test("reschedule requires the observed appointment and revision",async()=>{
    expect((await runSetterBookingAction(form({action:"reschedule",startsAt:"2026-11-06T16:00:00Z"}))).ok).toBe(false);
    expect(state.serviceCalls).toBe(0);
  });
  test("infrastructure details never reach the picker",async()=>{
    state.error={message:"private database credentials"};
    const result=await runSetterBookingAction(form());
    expect(result.ok).toBe(false);expect(result.message).not.toContain("private database credentials");
  });
});
