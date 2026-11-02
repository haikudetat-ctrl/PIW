"use server";
import {z} from "zod";
import {revalidatePath} from "next/cache";
import {createServerClient} from "@/lib/supabase/server";
import {setterTextingSchema,type SetterTextingContext} from "@/modules/sms/approved-schema";
import {approvedSmsReady,createApprovedSmsDependencies} from "@/modules/sms/approved-runtime";
import {processApprovedSmsDelivery} from "@/modules/sms/approved-delivery";
const claim={taskId:z.uuid(),token:z.uuid()};
const command=z.discriminatedUnion("action",[
 z.object({action:z.literal("load"),...claim}).strict(),
 z.object({action:z.literal("send"),...claim,templateId:z.uuid()}).strict(),
 z.object({action:z.literal("pause"),...claim,paused:z.enum(["true","false"])}).strict(),
]);
export type SetterTextingResult={ok:boolean;message:string;context?:SetterTextingContext;ready?:boolean};
export async function runSetterTextingAction(form:FormData):Promise<SetterTextingResult>{
 const parsed=command.safeParse(Object.fromEntries(form));
 if(!parsed.success)return {ok:false,message:"Invalid texting request. Reload the queue."};
 try{
 const c=parsed.data,db=await createServerClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return {ok:false,message:"Queue access required"};
 const args={p_task_id:c.taskId,p_claim_token:c.token};
 const load=async()=>{const {data,error}=await db.rpc("get_setter_texting_context",args);if(error)throw error;return setterTextingSchema.parse(data);};
 const context=await load(),ready=approvedSmsReady(context.company_id);
 if(c.action==="load")return {ok:true,message:"Choose approved wording",context,ready};
 if(c.action==="pause"){
   const {error}=await db.rpc("set_setter_sms_pause",{...args,p_paused:c.paused==="true"});if(error)throw error;
   revalidatePath("/setter-queue");return {ok:true,message:c.paused==="true"?"Automatic texts paused for this phone":"Future automatic texts resumed. Skipped texts stay closed.",context:await load(),ready};
 }
 if(!ready)return {ok:false,message:"Texting is not ready for this company. Ask your manager.",context,ready};
 if(!context.templates.some(t=>t.id===c.templateId))return {ok:false,message:"Choose a currently approved template",context,ready};
 const queued=await db.rpc("queue_setter_template_sms",{...args,p_template_id:c.templateId});if(queued.error)throw queued.error;
 const deliveryId=z.uuid().parse(queued.data);
 const result=await processApprovedSmsDelivery({companyId:context.company_id,deliveryId},createApprovedSmsDependencies());
 const next=await load();
 const status=next.delivery?.status??result.outcome;
 const message=status==="accepted"?"Twilio accepted the text. Delivery updates appear in the conversation.":status==="unknown"||status==="sending"?"Text needs verification. Ask a company admin to check Twilio logs before any follow-up.":status==="queued"||status==="preparing"?"Text queued. Quiet hours and current consent are checked before sending.":"Text was not sent. Check the delivery status and record your call outcome.";
 revalidatePath("/setter-queue");return {ok:!["failed","skipped"].includes(status),message,context:next,ready};
 }catch{return {ok:false,message:"Claim or texting access changed. Reload the queue before sending again."};}
}
