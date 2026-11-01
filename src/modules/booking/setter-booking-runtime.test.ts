// @vitest-environment node
import {beforeEach,describe,expect,test,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {bookConsultation,rescheduleConsultation,BookingRequestError} from "./booking-service";
import type {BookingRuntimeConfiguration} from "./booking-runtime";
import {createSetterBookingDependencies,loadSetterBookingAvailability,type SetterBookingContext} from "./setter-booking-runtime";
import {signBookingLink} from "./booking-link-token";

const companyId="b6000000-0000-4000-8000-000000000001";
const leadId="b6000000-0000-4000-8000-000000000201";
const linkId="b6000000-0000-4000-8000-000000000501";
const appointmentId="b6000000-0000-4000-8000-000000000601";
const context:SetterBookingContext={companyId,leadId,linkId,userId:"b6000000-0000-4000-8000-000000000101",taskId:"b6000000-0000-4000-8000-000000000301",claimToken:"b6000000-0000-4000-8000-000000000401"};
const startsAt="2026-11-06T15:00:00.000Z";
const configuration={signingSecret:"test-booking-secret-at-least-32-bytes",calendar:{listBusy:vi.fn(async()=>[])},appBaseUrl:null,fromEmail:null,resendApiKey:null} as unknown as BookingRuntimeConfiguration;
const token=signBookingLink(linkId,configuration.signingSecret);
type Row=Record<string,unknown>;

function fixture(expected?:{appointmentId:string;revision:number}) {
  const appointments:Row[]=[];
  let error:{message:string}|null=null;
  const tables:Record<string,Row[]>={
    booking_links:[{id:linkId,company_id:companyId,lead_id:leadId,expires_at:"2026-12-01T15:00:00.000Z",revoked_at:null}],
    leads:[{id:leadId,company_id:companyId,name:"Dana Rivera",email:"dana@example.com"}],
    booking_settings:[{company_id:companyId,is_enabled:true,timezone:"America/New_York",meeting_title:"Video inspection",meeting_duration_minutes:30,slot_interval_minutes:30,buffer_minutes:0,minimum_notice_minutes:60,booking_horizon_days:14,concurrent_capacity:1,google_calendar_id:"test@example.com",send_calendar_invites:true,support_phone:null}],
    booking_availability_windows:Array.from({length:7},(_,weekday)=>({company_id:companyId,weekday,start_minute:540,end_minute:1020})),
    booking_blackouts:[],appointments,
  };
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
    if(error) return {data:null,error};
    appointments.splice(0,appointments.length,{id:appointmentId,company_id:companyId,lead_id:leadId,booking_source:"self_service",meeting_type:"virtual",status:"scheduled",scheduled_at:args.p_starts_at,duration_minutes:30,meeting_url:null,calendar_sync_status:"pending",attendee_email:"dana@example.com",revision:args.p_action==="reschedule"?2:1});
    return {error:null,data:[{outcome:args.p_action==="reschedule"?"rescheduled":"booked",problem:null,appointment_id:appointmentId,scheduled_at:args.p_starts_at,duration_minutes:30,revision:2,event:null}]};
  });
  const client={rpc,from:(table:string)=>{
    const filters:Array<(row:Row)=>boolean>=[];
    const query={
      select:()=>query,update:()=>query,
      eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return query;},
      neq:(k:string,v:unknown)=>{filters.push(r=>r[k]!==v);return query;},
      in:(k:string,v:unknown[])=>{filters.push(r=>v.includes(r[k]));return query;},
      lt:(k:string,v:string)=>{filters.push(r=>String(r[k])<v);return query;},
      gt:(k:string,v:string)=>{filters.push(r=>String(r[k])>v);return query;},
      gte:(k:string,v:string)=>{filters.push(r=>String(r[k])>=v);return query;},
      maybeSingle:async()=>({data:tables[table].find(r=>filters.every(f=>f(r)))??null,error:null}),
      then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:tables[table].filter(r=>filters.every(f=>f(r))),error:null}).then(resolve),
    };return query;
  }} as unknown as SupabaseClient<Database>;
  const dependencies=createSetterBookingDependencies(configuration,client,context,expected);
  dependencies.now=()=>new Date("2026-11-01T15:00:00Z");
  dependencies.publish=vi.fn(async()=>{});
  dependencies.logError=()=>{};
  return {dependencies,rpc,appointments,setError:(value:{message:string})=>{error=value;}};
}

beforeEach(()=>{vi.mocked(configuration.calendar.listBusy).mockReset().mockResolvedValue([]);});
describe("setter booking runtime",()=>{
  test("lists actual slot-engine availability without exposing the capability",async()=>{
    const f=fixture();
    const result=await loadSetterBookingAvailability(token,context,f.dependencies);
    expect(result.model.kind).toBe("open");
    expect(result.model.days.flatMap(d=>d.slots).some(s=>s.startsAt===startsAt)).toBe(true);
    expect(result.revision).toBeNull();
    expect(JSON.stringify(result)).not.toContain(token);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  test("books through the service-only claim boundary with server context",async()=>{
    const f=fixture();
    const result=await bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies);
    expect(result.appointmentId).toBe(appointmentId);
    expect(f.rpc).toHaveBeenCalledWith("save_setter_virtual_booking",{
      p_company_id:companyId,p_user_id:context.userId,p_task_id:context.taskId,p_claim_token:context.claimToken,p_link_id:linkId,
      p_action:"book",p_starts_at:startsAt,p_appointment_id:null,p_expected_revision:null,p_attendee_email:null,p_customer_notes:null,p_request_ip:"203.0.113.61",
    });
  });
  test("calendar outage never reaches the commit RPC",async()=>{
    const f=fixture();vi.mocked(configuration.calendar.listBusy).mockRejectedValue(new Error("Google unavailable"));
    await expect(bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies)).rejects.toMatchObject({code:"calendar"});
    expect(f.rpc).not.toHaveBeenCalled();
  });
  test("a calendar block removes the proposed slot before any mutation",async()=>{
    const f=fixture();vi.mocked(configuration.calendar.listBusy).mockResolvedValue([{start:new Date(startsAt),end:new Date("2026-11-06T15:30:00Z")}]);
    await expect(bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies)).rejects.toMatchObject({code:"slot_unavailable"});
    expect(f.rpc).not.toHaveBeenCalled();
  });
  test("claim loss at commit surfaces a safe reload error",async()=>{
    const f=fixture();f.setError({message:"Claim expired or changed; reload the queue"});
    await expect(bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies)).rejects.toMatchObject({code:"claim_changed"});
    expect(f.appointments).toEqual([]);
  });
  test("rescheduling passes the screen's observed appointment and revision",async()=>{
    const f=fixture({appointmentId,revision:1});
    await bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies);
    f.rpc.mockClear();
    await rescheduleConsultation(token,{startsAt:"2026-11-06T16:00:00.000Z"},"203.0.113.61",f.dependencies);
    expect(f.rpc).toHaveBeenCalledWith("save_setter_virtual_booking",expect.objectContaining({p_action:"reschedule",p_appointment_id:appointmentId,p_expected_revision:1}));
    const availability=await loadSetterBookingAvailability(token,context,f.dependencies);
    expect(availability.revision).toBe(2);
    expect(availability.model.booking?.startsAt).toBe("2026-11-06T16:00:00.000Z");
  });
  test("a changed booking cannot be overwritten and internal errors remain private",async()=>{
    const f=fixture();
    f.setError({message:"Booking changed; reload available times"});
    await expect(f.dependencies.repository.reschedule({linkId,startsAt,requestIp:"203.0.113.61"})).rejects.toMatchObject({code:"booking_changed"});
    f.setError({message:"private database details"});
    await expect(bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies)).rejects.toBeInstanceOf(BookingRequestError);
    await expect(bookConsultation(token,{startsAt},"203.0.113.61",f.dependencies)).rejects.not.toThrow("private database details");
  });
});
