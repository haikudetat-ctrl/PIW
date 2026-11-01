import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {createBookingDependencies,type BookingRuntimeConfiguration} from "./booking-runtime";
import {BookingRequestError,loadBookingPage,type BookingDependencies,type BookingPageModel} from "./booking-service";
import {parseOutcome,raiseFor,SupabaseBookingRepository} from "./supabase-booking-repository";

export type SetterBookingContext={companyId:string;leadId:string;linkId:string;userId:string;taskId:string;claimToken:string};
export type SetterBookingAvailability={
  model:Extract<BookingPageModel,{kind:"open"|"booked"}>;
  revision:number|null;
  calendarAvailable:boolean;
};
type ObservedBooking={appointmentId:string;revision:number};

class SetterBookingRepository extends SupabaseBookingRepository {
  constructor(private readonly service:SupabaseClient<Database>,private readonly context:SetterBookingContext,private readonly observed?:ObservedBooking) {
    super(service);
  }

  private async save(action:"book"|"reschedule",input:{linkId:string;startsAt:string;requestIp:string;attendeeEmail?:string|null;notes?:string|null}) {
    if(input.linkId!==this.context.linkId) throw new BookingRequestError("Claim expired or changed; reload the queue",409,"claim_changed");
    const {data,error}=await this.service.rpc("save_setter_virtual_booking",{
      p_company_id:this.context.companyId,p_user_id:this.context.userId,p_task_id:this.context.taskId,
      p_claim_token:this.context.claimToken,p_link_id:this.context.linkId,p_action:action,p_starts_at:input.startsAt,
      p_appointment_id:(action==="reschedule"?this.observed?.appointmentId??null:null) as string,
      p_expected_revision:(action==="reschedule"?this.observed?.revision??null:null) as number,
      p_attendee_email:(input.attendeeEmail??null) as string,p_customer_notes:(input.notes??null) as string,p_request_ip:input.requestIp,
    });
    if(error?.message==="Queue access required" || error?.message==="Claim expired or changed; reload the queue") {
      throw new BookingRequestError("Claim expired or changed; reload the queue",409,"claim_changed");
    }
    if(error?.message==="Booking changed; reload available times") {
      throw new BookingRequestError("Booking changed; reload available times",409,"booking_changed");
    }
    raiseFor(error);
    return parseOutcome(data);
  }

  override book(input:{linkId:string;startsAt:string;attendeeEmail:string|null;notes:string|null;requestIp:string}) {
    return this.save("book",input);
  }
  override reschedule(input:{linkId:string;startsAt:string;requestIp:string}) {
    return this.save("reschedule",input);
  }
}

/** Reuse all booking logic; only the final database mutation is claim-bound. */
export function createSetterBookingDependencies(
  configuration:BookingRuntimeConfiguration,service:SupabaseClient<Database>,context:SetterBookingContext,observed?:ObservedBooking,
):BookingDependencies {
  const dependencies=createBookingDependencies(configuration,service);
  const verify=dependencies.verifyToken;
  return {...dependencies,repository:new SetterBookingRepository(service,context,observed),verifyToken:token=>{
    const linkId=verify(token);
    return linkId===context.linkId?linkId:null;
  }};
}

export async function loadSetterBookingAvailability(token:string,context:SetterBookingContext,dependencies:BookingDependencies):Promise<SetterBookingAvailability> {
  let calendarAvailable=true;
  const tracked:BookingDependencies={...dependencies,calendar:{async listBusy(calendarId,from,to,timeZone) {
    try {return await dependencies.calendar.listBusy(calendarId,from,to,timeZone);}
    catch(error) {calendarAvailable=false;throw error;}
  }}};
  const model=await loadBookingPage(token,tracked);
  if(model.kind!=="open" && model.kind!=="booked") {
    throw new BookingRequestError("Virtual booking is unavailable. Ask your manager or try again later.",503,"unavailable");
  }
  const active=await dependencies.repository.findActiveBooking(context.companyId,context.leadId);
  if((active?.id??null)!==(model.booking?.appointmentId??null) || (active && new Date(active.scheduledAt).toISOString()!==model.booking?.startsAt)) {
    throw new BookingRequestError("Booking changed; reload available times",409,"booking_changed");
  }
  return {model,revision:active?.revision??null,calendarAvailable};
}
