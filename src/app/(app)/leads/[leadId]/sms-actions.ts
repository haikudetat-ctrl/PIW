"use server";

import { revalidatePath } from "next/cache";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSmsContext } from "@/modules/sms/load-context";
import { sendLeadSms, type SendResult } from "@/modules/sms/send-lead-sms";
import {sendCompanySms} from "@/modules/sms/client-config";

export type SmsFormState = SendResult | null;

export async function sendSms(leadId: string, _previous: SmsFormState, formData: FormData): Promise<SmsFormState> {
  const body = String(formData.get("body") ?? "");
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = parseMyAccess((await supabase.rpc("get_my_access")).data);
  if (!user || !access || !canUseCrm(access)) return { ok: false, reason: "not_found", message: "You can't text from Rake." };

  const service = createServiceClient();
  const context = await loadSmsContext(supabase, service, leadId);

  const smsEnabled = process.env.SMS_ENABLED === "true";
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const result = await sendLeadSms(context, body, {
    now: new Date(),
    smsEnabled,
    userId: user.id,
    statusCallback: productionHost ? `https://${productionHost}/api/twilio/sms/status` : null,
    async insertMessage(row) {
      const { data, error } = await service.from("sms_messages").insert(row).select("id").single();
      if (error || !data) throw new Error("Failed to save the text");
      return data;
    },
    async updateMessage(id, patch) {
      await service
        .from("sms_messages")
        .update({ ...patch, status_updated_at: new Date().toISOString() })
        .eq("id", id);
    },
    send(input) {
      // The company comes from the RLS-authorized lead, never form input.
      return sendCompanySms(context!.companyId, input);
    },
  });

  revalidatePath(`/leads/${leadId}`);
  return result;
}
