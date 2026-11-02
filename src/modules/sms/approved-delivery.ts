import {formatMeetingTime} from "@/modules/booking/booking-format";
import type {ApprovedSmsJob} from "./approved-schema";
import {renderApprovedTemplate} from "./approved-templates";
import {mapTwilioStatus} from "./rules";
import {SmsProviderError} from "./twilio";
export type ApprovedDeliveryDependencies={
 ready(companyId:string):boolean; automationEnabled:boolean;
 claim(companyId:string,deliveryId?:string):Promise<ApprovedSmsJob|null>;
 start(job:ApprovedSmsJob,body:string,segments:number):Promise<{started:boolean;reason?:string}>;
 settle(job:ApprovedSmsJob,outcome:"accepted"|"rejected"|"unknown"|"skipped",sid?:string,status?:string,errorCode?:string):Promise<string>;
 manageUrl(job:ApprovedSmsJob):Promise<string|null>;
 send(job:ApprovedSmsJob,body:string):Promise<{sid:string;status:string}>;
};
export type ApprovedDeliveryResult={outcome:string;reason?:string;id?:string};
/** The DB reserves intent before networking. A network-started intent is never reclaimed. */
export async function processApprovedSmsDelivery(input:{companyId:string;deliveryId?:string},d:ApprovedDeliveryDependencies):Promise<ApprovedDeliveryResult>{
 if(!d.ready(input.companyId))return {outcome:"disabled"};
 const j=await d.claim(input.companyId,input.deliveryId);
 if(!j)return {outcome:"idle"};
 if(j.company_id!==input.companyId)throw new Error("SMS delivery company mismatch");
 const skip=async(reason:string)=>{await d.settle(j,"skipped",undefined,undefined,reason);return {outcome:"skipped",reason,id:j.id};};
 if(j.source==="automatic"&&!d.automationEnabled)return skip("client_not_ready");
 if(!j.template)return skip("no_approved_template");
 let bookingLink:string|null=null,bookingTime:string|null=null;
 if(j.source==="automatic"){
   bookingLink=await d.manageUrl(j);
   if(!bookingLink)return skip("booking_link_unavailable");
   try {bookingTime=j.scheduled_at?formatMeetingTime(j.scheduled_at,j.timezone):null;}catch{return skip("invalid_render");}
 }
 const rendered=renderApprovedTemplate(j.template.body,{first_name:j.first_name,company_name:j.company_name,booking_time:bookingTime,booking_link:bookingLink});
 if(!rendered.ok)return skip(rendered.reason);
 if(!d.ready(j.company_id))return skip("client_not_ready");
 const start=await d.start(j,rendered.body,rendered.segments);
 if(!start.started)return {outcome:"blocked",reason:start.reason,id:j.id};
 // Keep transport errors separate from settlement errors: an accepted POST with a
 // failed DB write must never be classified as a definitive provider rejection.
 let response:{sid:string;status:string};
 try {response=await d.send(j,rendered.body);}catch(error){
   const rejected=error instanceof SmsProviderError&&error.acceptance==="rejected";
   try {return {outcome:await d.settle(j,rejected?"rejected":"unknown",undefined,undefined,rejected?error.code??"provider_rejected":"acceptance_unknown"),id:j.id};}
   catch{return {outcome:"unknown",id:j.id};}
 }
 try {const status=mapTwilioStatus(response.status);if(!status)return {outcome:await d.settle(j,"unknown",undefined,undefined,"invalid_response"),id:j.id};
 return {outcome:await d.settle(j,"accepted",response.sid,status),id:j.id};}
 catch{return {outcome:"unknown",id:j.id};}
}
