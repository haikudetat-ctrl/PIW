"use server";
import {z} from "zod";
import {revalidatePath} from "next/cache";
import {createServerClient} from "@/lib/supabase/server";
import {hasRole,parseMyAccess} from "@/lib/auth/access";
import {approvedSmsReady} from "@/modules/sms/approved-runtime";
import {smsKindSchema} from "@/modules/sms/approved-schema";
const command=z.discriminatedUnion("action",[
 z.object({action:z.literal("draft"),kind:smsKindSchema,body:z.string().trim().min(1).max(1600)}).strict(),
 z.object({action:z.literal("approve"),id:z.uuid()}).strict(),z.object({action:z.literal("retire"),id:z.uuid()}).strict(),
 z.object({action:z.literal("settings"),enabled:z.enum(["true","false"]),timezone:z.string().min(1).max(100).refine(v=>{try{new Intl.DateTimeFormat("en-US",{timeZone:v});return true;}catch{return false;}})}).strict(),
 z.object({action:z.literal("resume"),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/)}).strict(),
 z.object({action:z.literal("resolve"),id:z.uuid(),resolution:z.enum(["accepted","not_sent"]),sid:z.string().max(34),note:z.string().trim().min(10).max(2000),verified:z.literal("true")}).strict().refine(v=>v.resolution==="accepted"?/^(SM|MM)[0-9a-fA-F]{32}$/.test(v.sid):v.sid===""),
]);
export type TextingActionResult={ok:boolean;message:string};
export async function runTextingSettingsAction(form:FormData):Promise<TextingActionResult>{
 const parsed=command.safeParse(Object.fromEntries(form));
 if(!parsed.success)return {ok:false,message:"Check the fields. Reconciliation requires a verified Twilio log review."};
 try{
 const db=await createServerClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return {ok:false,message:"Company admin access required"};
 const access=parseMyAccess((await db.rpc("get_my_access")).data);
 if(!access||!hasRole(access,"company_admin"))return {ok:false,message:"Company admin access required"};
 const c=parsed.data;let result:{error:unknown};let message="Saved";
 switch(c.action){
 case "draft":result=await db.rpc("save_sms_template_draft",{p_kind:c.kind,p_body:c.body});message="Draft saved. Review the exact wording before approval.";break;
 case "approve":result=await db.rpc("approve_sms_template",{p_template_id:c.id});message="Version approved. The previous approved version is retired.";break;
 case "retire":result=await db.rpc("retire_sms_template",{p_template_id:c.id});message="Template retired";break;
 case "settings":
   if(c.enabled==="true"&&!approvedSmsReady(access.companyId))return {ok:false,message:"This company's texting transport is not ready. Ask 2Stack to finish sender setup."};
   result=await db.rpc("save_sms_automation_settings",{p_enabled:c.enabled==="true",p_timezone:c.timezone});message="Automation settings saved. Existing appointments are not backfilled.";break;
 case "resume":result=await db.rpc("set_company_sms_pause",{p_phone_e164:c.phone,p_paused:false});message="Future automatic texts resumed for this phone. Skipped texts stay closed.";break;
 case "resolve":result=await db.rpc("resolve_sms_delivery",{p_id:c.id,p_resolution:c.resolution,p_provider_sid:c.sid,p_note:c.note});message="Verified outcome recorded. No text was resent.";break;
 }
 if(result.error)return {ok:false,message:"Could not save. Check template fields, sender readiness and current delivery status, then reload."};
 revalidatePath("/settings/texting");revalidatePath("/setter-queue");return {ok:true,message};
 }catch{return {ok:false,message:"Texting settings are unavailable. No send was requested."};}
}
