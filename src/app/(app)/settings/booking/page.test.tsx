import {render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,test,vi} from "vitest";

vi.mock("@/inngest/client",()=>({inngest:{send:vi.fn()}}));
vi.mock("./actions",()=>({saveBookingSettings:async()=>null,addBlackout:async()=>{},removeBlackout:async()=>{},addRep:async()=>{},updateRep:async()=>{}}));
vi.mock("@/lib/supabase/server",()=>({createServerClient:async()=>({
  from(table:string) {
    const empty=async()=>({data:[],error:null});
    if(table==="booking_settings") return {select:()=>({maybeSingle:async()=>({data:null,error:null})})};
    if(table==="booking_availability_windows") return {select:()=>({order:empty})};
    if(table==="booking_blackouts") return {select:()=>({gte:()=>({order:empty})})};
    if(table==="reps") return {select:()=>({order:()=>({order:empty})})};
    throw new Error(`Unexpected table ${table}`);
  },
})}));

import BookingSettingsPage from "./page";

beforeEach(()=>{
  for(const [key,value] of Object.entries({
    NODE_ENV:"test",DEPLOYMENT_ENV:"test",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"local-publishable-key",SUPABASE_SERVICE_ROLE_KEY:"local-service-role-key",
    INNGEST_EVENT_KEY:"local-event-key",INNGEST_SIGNING_KEY:"local-signing-key",
    SMS_ENABLED:"true",VIRTUAL_BOOKING_ENABLED:"false",
  })) vi.stubEnv(key,value);
});
afterEach(()=>vi.unstubAllEnvs());

test.each([undefined,"bad-json"])("booking settings loads while optional SMS registry is invalid: %s",async(registry)=>{
  vi.stubEnv("TWILIO_SMS_CLIENTS_JSON",registry);
  render(await BookingSettingsPage());
  expect(screen.getByRole("heading",{name:"Video booking"})).toBeInTheDocument();
  expect(screen.getByLabelText(/Shared Google Calendar ID/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox",{name:/Homeowners can book video consultations/})).not.toBeChecked();
});
