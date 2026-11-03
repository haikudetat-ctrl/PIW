import "server-only";
import {z} from "zod";
import {createServiceClient} from "@/lib/supabase/service";
import {buildBookingUrl} from "@/modules/booking/booking-runtime";
import {approvedSmsJobSchema} from "./approved-schema";
import {isCompanySmsEnabled,sendCompanySms} from "./client-config";
import type {ApprovedDeliveryDependencies} from "./approved-delivery";

export function smsCallbackBase():string|null {
 try {
   const raw=process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
   if(!raw)return null;
   const url=new URL(raw.startsWith("https://")?raw:`https://${raw}`);
   if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||url.hostname==="localhost"||!url.hostname.includes("."))return null;
   return url.origin;
 }catch{return null;}
}
export function approvedSmsReady(companyId:string){return isCompanySmsEnabled(companyId)&&smsCallbackBase()!==null;}
export function createApprovedSmsDependencies():ApprovedDeliveryDependencies {
 const db=createServiceClient();
 return {
   ready:approvedSmsReady,automationEnabled:process.env.SMS_AUTOMATION_ENABLED==="true",
   async claim(companyId,deliveryId){
     if(!deliveryId&&process.env.SMS_AUTOMATION_ENABLED!=="true"){
       const now=new Date().toISOString();
       const {data,error}=await db.from("sms_delivery_jobs").select("id").eq("company_id",companyId).eq("source","manual").in("status",["queued","preparing"]).lte("not_before",now).gt("expires_at",now).or(`status.eq.queued,preparing_until.lte.${now}`).order("not_before").limit(1).maybeSingle();
       if(error)throw new Error("SMS reservation unavailable");
       if(!data)return null;
       deliveryId=data.id;
     }
     const {data,error}=await db.rpc("claim_approved_sms_delivery",{p_company_id:companyId,...(deliveryId?{p_id:deliveryId}:{})});
     if(error)throw new Error("SMS reservation unavailable");
     return data===null?null:approvedSmsJobSchema.parse(data);
   },
   async start(job,body,segments){
     const {data,error}=await db.rpc("start_approved_sms_delivery",{p_id:job.id,p_token:job.attempt_token,p_template_id:job.template!.id,p_body:body,p_to:job.to_e164??"",p_from:job.from_e164??"",p_service_sid:job.messaging_service_sid??"",p_segments:segments});
     if(error)throw new Error("SMS send authorization unavailable");
     return z.object({started:z.boolean(),reason:z.string().optional()}).parse(data);
   },
   async settle(job,outcome,sid,status,errorCode){
     const {data,error}=await db.rpc("settle_approved_sms_delivery",{p_id:job.id,p_token:job.attempt_token,p_outcome:outcome,p_sid:sid??"",p_status:status??"",p_error_code:errorCode??""});
     if(error)throw new Error("SMS settlement unavailable");
     return data;
   },
   async manageUrl(job){
     const signingSecret=process.env.BOOKING_LINK_SIGNING_SECRET;
     const appBaseUrl=smsCallbackBase();
     if(!job.booking_link_id||!signingSecret||Buffer.byteLength(signingSecret)<32||!appBaseUrl)return null;
     return buildBookingUrl(db,{signingSecret,appBaseUrl},job.company_id,job.booking_link_id);
   },
   async send(job,body){
     const callback=new URL("/api/twilio/sms/status",smsCallbackBase()!);
     callback.searchParams.set("delivery",job.id);callback.searchParams.set("attempt",job.attempt_token);
     return sendCompanySms(job.company_id,{messagingServiceSid:job.messaging_service_sid!,from:job.from_e164!,to:job.to_e164!,body,statusCallback:callback.toString()});
   },
 };
}
