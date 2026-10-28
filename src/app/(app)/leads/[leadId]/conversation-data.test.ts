// @vitest-environment node
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";

// Keep createServiceClient and shared environment parsing real. Only replace
// the SDK's network boundary; no production database or credentials are used.
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({rpc:async()=>({data:false,error:null})})}));
import {loadConversation} from "./conversation-data";

const companyId="10000000-0000-4000-8000-000000000001";
const leadId="20000000-0000-4000-8000-000000000001";
const tables:Record<string,unknown>={
  leads:{id:leadId,company_id:companyId,phone:"6095550101",phone_e164:"+16095550101"},
  lead_consents:{granted:true},
  company_sms_settings:{enabled:true,messaging_service_sid:`MG${"1".repeat(32)}`,from_e164:"+16095550102",quiet_start_hour:21,quiet_end_hour:8},
  companies:{name:"AllSeason"},
  sms_messages:[{id:"message-1",direction:"outbound",body:"Your estimate is ready.",status:"delivered",error_code:null,created_at:"2026-10-28T14:00:00Z"}],
};
const member={
  from(table:string) {
    const response={data:tables[table],error:null};
    const query={select:()=>query,eq:()=>query,order:()=>query,limit:()=>Promise.resolve(response),maybeSingle:()=>Promise.resolve(response)};
    return query;
  },
  rpc:async()=>({data:[{user_id:"30000000-0000-4000-8000-000000000001",company_id:companyId,display_name:"Demo Setter",role:"manager",is_platform_admin:false}],error:null}),
} as unknown as SupabaseClient<Database>;

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-28T16:00:00Z"));
  for(const [key,value] of Object.entries({
    NODE_ENV:"test",DEPLOYMENT_ENV:"test",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"local-publishable-key",SUPABASE_SERVICE_ROLE_KEY:"local-service-role-key",
    INNGEST_EVENT_KEY:"local-event-key",INNGEST_SIGNING_KEY:"local-signing-key",SMS_ENABLED:"true",
    TWILIO_SMS_CLIENTS_JSON:"bad-json",
  })) vi.stubEnv(key,value);
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});

test("lead conversation loads its history while unconfigured texting is blocked",async()=>{
  const result=await loadConversation(member,{id:leadId,name:"Dana Rivera",company_id:companyId});
  expect(result.messages).toMatchObject([{body:"Your estimate is ready.",status:"delivered"}]);
  expect(result.to).toBe("(609) 555-0101");
  expect(result.fields.company_name).toBe("AllSeason");
  expect(result.blockedReason).toBe("Texting isn't set up for this company yet.");
});
