import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toUsE164 } from "./rules";
import type { SmsContext } from "./send-lead-sms";

// The member's client reads the lead, its SMS consent and the company's SMS
// settings under RLS; only the suppression check needs the service role.
export async function loadSmsContext(
  supabase: SupabaseClient<Database>,
  service: SupabaseClient<Database>,
  leadId: string,
): Promise<SmsContext | null> {
  const [{ data: lead }, { data: consent }, { data: settings }] = await Promise.all([
    supabase.from("leads").select("id, company_id, phone, phone_e164").eq("id", leadId).maybeSingle(),
    supabase
      .from("lead_consents")
      .select("granted")
      .eq("lead_id", leadId)
      .eq("consent_type", "sms_contact")
      .maybeSingle(),
    supabase
      .from("company_sms_settings")
      .select("enabled, messaging_service_sid, from_e164, quiet_start_hour, quiet_end_hour")
      .maybeSingle(),
  ]);
  if (!lead) return null;

  const phone = lead.phone_e164 ?? lead.phone;
  const e164 = toUsE164(phone);
  const { data: suppressed } = e164
    ? await service.rpc("is_suppressed", {
        p_company_id: lead.company_id,
        p_channel: "sms",
        p_phone_e164: e164,
        // The function takes a null email when checking a phone.
        p_email_normalized: null as unknown as string,
      })
    : { data: false };

  return {
    companyId: lead.company_id,
    leadId: lead.id,
    phone,
    smsConsent: consent?.granted === true,
    suppressed: suppressed === true,
    settings: settings
      ? {
          enabled: settings.enabled,
          messagingServiceSid: settings.messaging_service_sid,
          fromE164: settings.from_e164,
          quietStartHour: settings.quiet_start_hour,
          quietEndHour: settings.quiet_end_hour,
        }
      : null,
  };
}
