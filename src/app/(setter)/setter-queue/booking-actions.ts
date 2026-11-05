"use server";

import {z} from "zod";
import {headers} from "next/headers";
import {revalidatePath} from "next/cache";
import {createServerClient} from "@/lib/supabase/server";
import {createServiceClient} from "@/lib/supabase/service";
import {parseServerEnv} from "@/lib/env/server";
import {trustedRequestIp} from "@/modules/roof-assessment/trusted-request-ip";
import {resolveBookingConfiguration} from "@/modules/booking/booking-runtime";
import {signBookingLink} from "@/modules/booking/booking-link-token";
import {bookConsultation,rescheduleConsultation,BookingRequestError,type BookingSummary} from "@/modules/booking/booking-service";
import {createSetterBookingDependencies,loadSetterBookingAvailability,type SetterBookingAvailability} from "@/modules/booking/setter-booking-runtime";

export type SetterBookingResult={ok:boolean;message:string;code?:string;availability?:SetterBookingAvailability;booking?:BookingSummary};
const claim={taskId:z.uuid(),token:z.uuid()};
const commandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("load"),...claim}).strict(),
  z.object({action:z.literal("book"),...claim,startsAt:z.iso.datetime({offset:true}),attendeeEmail:z.union([z.literal(""),z.email().max(254)]).optional(),notes:z.string().trim().max(1000).optional()}).strict(),
  z.object({action:z.literal("reschedule"),...claim,startsAt:z.iso.datetime({offset:true}),appointmentId:z.uuid(),revision:z.coerce.number().int().positive().safe()}).strict(),
]);
const contextSchema=z.array(z.object({company_id:z.uuid(),lead_id:z.uuid(),link_id:z.uuid()})).length(1);

export async function runSetterBookingAction(formData:FormData):Promise<SetterBookingResult> {
  const parsed=commandSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success) return {ok:false,message:"Check the booking details and reload available times.",code:"invalid"};
  const command=parsed.data;
  try {
    const member=await createServerClient();
    const {data:{user}}=await member.auth.getUser();
    if(!user) return {ok:false,message:"Sign in to access the setter queue.",code:"claim_changed"};
    const configuration=resolveBookingConfiguration();
    if(!configuration) return {ok:false,message:"Virtual booking is not set up yet. Ask your manager.",code:"unavailable"};
    const {data,error}=await member.rpc("get_setter_booking_context",{p_task_id:command.taskId,p_claim_token:command.token});
    if(error) {
      if(error.message==="Queue access required" || error.message==="Claim expired or changed; reload the queue") {
        return {ok:false,message:"Claim expired or changed; reload the queue",code:"claim_changed"};
      }
      throw error;
    }
    const row=contextSchema.parse(data)[0];
    const context={companyId:row.company_id,leadId:row.lead_id,linkId:row.link_id,userId:user.id,taskId:command.taskId,claimToken:command.token};
    const service=createServiceClient();
    const observed=command.action==="reschedule"?{appointmentId:command.appointmentId,revision:command.revision}:undefined;
    const dependencies=createSetterBookingDependencies(configuration,service,context,observed);
    const token=signBookingLink(context.linkId,configuration.signingSecret);
    if(command.action==="load") {
      return {ok:true,message:"Available virtual inspection times",availability:await loadSetterBookingAvailability(token,context,dependencies)};
    }
    const requestIp=trustedRequestIp(await headers(),parseServerEnv(process.env).DEPLOYMENT_ENV);
    if(!requestIp) return {ok:false,message:"Couldn't verify this request. Reload and try again.",code:"invalid"};
    try {
      const booking=command.action==="book"
        ?await bookConsultation(token,{startsAt:command.startsAt,attendeeEmail:command.attendeeEmail??"",notes:command.notes??""},requestIp,dependencies)
        :await rescheduleConsultation(token,{startsAt:command.startsAt},requestIp,dependencies);
      revalidatePath("/setter-queue");revalidatePath("/appointments");revalidatePath(`/leads/${context.leadId}`);
      return {ok:true,message:command.action==="book"?"Virtual inspection booked. Save the outcome to finish.":"Virtual inspection moved. Save the outcome to finish.",booking};
    } catch(error) {
      if(error instanceof BookingRequestError && ["slot_unavailable","already_booked","booking_changed"].includes(error.code)) {
        // Preserve the business error even if a subsequent calendar refresh fails.
        const availability=await loadSetterBookingAvailability(token,context,dependencies).catch(()=>undefined);
        return {ok:false,message:error.message,code:error.code,availability};
      }
      throw error;
    }
  } catch(error) {
    if(error instanceof BookingRequestError) return {ok:false,message:error.message,code:error.code};
    return {ok:false,message:"Couldn't load or save virtual booking. Reload and try again.",code:"unavailable"};
  }
}
