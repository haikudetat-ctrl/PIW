import {countSegments,fillTemplate,MAX_SEGMENTS} from "./rules";
import type {SmsKind} from "./approved-schema";
export function renderApprovedTemplate(body:string,fields:Record<string,string|null|undefined>) {
 const rendered=fillTemplate(body,fields);
 if(/[{}]/.test(rendered))return {ok:false as const,reason:"unfilled"};
 if(!rendered.trim())return {ok:false as const,reason:"invalid_render"};
 const {segments}=countSegments(rendered);
 if(segments>MAX_SEGMENTS)return {ok:false as const,reason:"too_long"};
 return {ok:true as const,body:rendered,segments};
}
export const SMS_DRAFT_SUGGESTIONS:Record<SmsKind,string>={
 first_touch:"Hi {first_name}, this is {company_name} following up on your roof request. When is a good time for a quick call? Reply STOP to opt out.",
 missed_call:"Hi {first_name}, {company_name} here. Sorry we missed you. Reply with a good time to call. Reply STOP to opt out.",
 booking_confirmation:"Hi {first_name}, {company_name} confirms your virtual appointment for {booking_time}. Manage: {booking_link}. Reply STOP to opt out.",
 booking_rescheduled:"Hi {first_name}, your virtual appointment with {company_name} is now {booking_time}. Manage: {booking_link}. Reply STOP to opt out.",
 reminder_day:"Hi {first_name}, {company_name} here. Your virtual appointment is {booking_time}. Manage: {booking_link}. Reply STOP to opt out.",
 reminder_hour:"Hi {first_name}, your virtual appointment with {company_name} starts soon: {booking_time}. Manage: {booking_link}. Reply STOP to opt out.",
};
