import {z} from "zod";
export const SMS_KINDS = ["first_touch","missed_call","booking_confirmation","booking_rescheduled","reminder_day","reminder_hour"] as const;
export const smsKindSchema = z.enum(SMS_KINDS);
export type SmsKind = z.infer<typeof smsKindSchema>;
export const SMS_KIND_LABELS:Record<SmsKind,string> = {first_touch:"First touch",missed_call:"Missed call",booking_confirmation:"Booking confirmation",booking_rescheduled:"Booking rescheduled",reminder_day:"Day-before reminder",reminder_hour:"Hour-before reminder"};
export const approvedSmsJobSchema = z.object({
 id:z.uuid(),company_id:z.uuid(),lead_id:z.uuid(),source:z.enum(["manual","automatic"]),kind:smsKindSchema,attempt_token:z.uuid(),
 template:z.object({id:z.uuid(),body:z.string(),version:z.number().int().positive()}).nullable(),
 first_name:z.string(),company_name:z.string(),to_e164:z.string().nullable(),from_e164:z.string().nullable(),messaging_service_sid:z.string().nullable(),
 booking_link_id:z.uuid().nullable(),scheduled_at:z.string().nullable(),timezone:z.string(),
});
export type ApprovedSmsJob = z.infer<typeof approvedSmsJobSchema>;
export const templateSchema=z.object({id:z.uuid(),kind:smsKindSchema,version:z.number(),body:z.string()});
export const setterTextingSchema=z.object({company_id:z.uuid(),company_name:z.string(),phone:z.string().nullable(),paused:z.boolean(),templates:z.array(templateSchema),delivery:z.object({id:z.uuid(),status:z.string(),reason:z.string().nullable(),template_id:z.uuid().nullable()}).nullable()});
export type SetterTextingContext=z.infer<typeof setterTextingSchema>;
export const smsPanelSchema=z.object({company_id:z.uuid(),company_name:z.string(),settings:z.object({enabled:z.boolean(),timezone:z.string()}),sender_ready:z.boolean(),templates:z.array(templateSchema.extend({status:z.enum(["draft","approved","retired"]),created_at:z.string(),approved_at:z.string().nullable()})),deliveries:z.array(z.object({id:z.uuid(),kind:smsKindSchema,source:z.string(),status:z.string(),reason:z.string().nullable(),created_at:z.string(),not_before:z.string(),expires_at:z.string(),appointment_revision:z.number().nullable(),message_status:z.string().nullable(),provider_sid:z.string().nullable(),lead_name:z.string().nullable()})),pauses:z.array(z.object({phone_e164:z.string(),reason:z.string(),updated_at:z.string()}))});
export type SmsControlPanel=z.infer<typeof smsPanelSchema>;
