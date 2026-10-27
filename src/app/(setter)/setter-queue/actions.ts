"use server";

import {revalidatePath} from "next/cache";
import {createServerClient} from "@/lib/supabase/server";
import {createServiceClient} from "@/lib/supabase/service";
import {parseMyAccess} from "@/lib/auth/access";
import {ensureBookingUrl,isVirtualBookingAvailable,resolveBookingConfiguration} from "@/modules/booking/booking-runtime";
import {parseQueueCommand,queueActionError,queueSnapshotSchema} from "@/modules/setter-queue/schema";

export type QueueActionResult={ok:boolean;message:string;bookingUrl?:string};

export async function runSetterQueueAction(formData:FormData):Promise<QueueActionResult> {
  try {
    const db=await createServerClient();
    const {data:{user}}=await db.auth.getUser();
    if(!user) return {ok:false,message:"Queue access required"};
    const {data,error}=await db.rpc("get_setter_queue");
    if(error) throw error;
    const snapshot=queueSnapshotSchema.parse(data);
    const command=parseQueueCommand(Object.fromEntries(formData),snapshot.timezone);
    let message="Saved";
    switch(command.action) {
      case "settings": {
        const result=await db.rpc("save_setter_queue_settings",{p_enabled:command.enabled==="true",p_timezone:command.timezone});
        if(result.error) throw result.error;
        message="Queue settings saved";break;
      }
      case "enroll": {
        const result=await db.rpc("set_company_setter",{p_user_id:command.userId,p_enabled:command.enabled==="true"});
        if(result.error) throw result.error;
        message="Setter enrollment updated";break;
      }
      case "shift": {
        const result=await db.rpc("set_setter_shift",{p_on_shift:command.onShift==="true"});
        if(result.error) throw result.error;
        message=command.onShift==="true"?"You are on shift for eight hours":"You are off shift";break;
      }
      case "claim": {
        const result=await db.rpc("claim_setter_task");
        if(result.error) throw result.error;
        message=result.data?"Lead claimed. Record an outcome before moving on.":"No lead is available to claim right now";break;
      }
      case "attempt": {
        const result=await db.rpc("record_setter_attempt",{p_task_id:command.taskId,p_claim_token:command.token});
        if(result.error) throw result.error;
        message="Manual call attempt recorded";break;
      }
      case "outcome": {
        const result=await db.rpc("finish_setter_task",{
          p_task_id:command.taskId,p_claim_token:command.token,p_outcome:command.outcome,p_notes:command.notes??undefined,
          p_callback_at:command.callbackAt??undefined,p_appointment_id:command.appointmentId??undefined,
        });
        if(result.error) throw result.error;
        message="Outcome saved";break;
      }
      case "booking_link": {
        const current=snapshot.current;
        if(!current || current.id!==command.taskId || current.claim_token!==command.token) {
          return {ok:false,message:"Claim expired or changed; reload the queue"};
        }
        const access=parseMyAccess((await db.rpc("get_my_access")).data);
        if(!access) return {ok:false,message:"Queue access required"};
        const configuration=resolveBookingConfiguration();
        if(!configuration) return {ok:false,message:"Virtual booking is not set up yet. Ask your manager."};
        const service=createServiceClient();
        if(!await isVirtualBookingAvailable(service,access.companyId)) return {ok:false,message:"Virtual booking is not enabled for this company."};
        const booking=await ensureBookingUrl({client:service,configuration,companyId:access.companyId,leadId:current.lead.id,source:"staff",createdBy:user.id});
        return {ok:true,message:"Use this link with the homeowner to choose real available capacity.",bookingUrl:booking.url};
      }
    }
    revalidatePath("/setter-queue");
    if(snapshot.current) revalidatePath(`/leads/${snapshot.current.lead.id}`);
    return {ok:true,message};
  } catch(error) {return {ok:false,message:queueActionError(error)};}
}
