import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMyAccess } from "@/lib/auth/access";
import type { Database } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSmsContext } from "@/modules/sms/load-context";
import { toUsE164 } from "@/modules/sms/rules";
import { leadSmsBlock } from "@/modules/sms/send-lead-sms";
import type { ConversationMessage } from "./conversation";

function formatUs(e164: string | null): string | null {
  if (!e164) return null;
  const digits = e164.replace(/^\+1/, "");
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export async function loadConversation(
  supabase: SupabaseClient<Database>,
  lead: { id: string; name: string; company_id: string },
) {
  const [context, { data: messages }, { data: accessRows }, { data: company }] = await Promise.all([
    loadSmsContext(supabase, createServiceClient(), lead.id),
    supabase
      .from("sms_messages")
      .select("id, direction, body, status, error_code, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase.rpc("get_my_access"),
    supabase.from("companies").select("name").eq("id", lead.company_id).maybeSingle(),
  ]);
  // Opening the conversation reads its replies.
  if ((messages ?? []).some((message) => message.direction === "inbound")) {
    await supabase.rpc("mark_sms_read", { p_lead_id: lead.id });
  }

  const block = leadSmsBlock(context, process.env.SMS_ENABLED === "true", new Date());
  const access = parseMyAccess(accessRows);
  return {
    messages: (messages ?? []) as ConversationMessage[],
    to: formatUs(toUsE164(context?.phone)),
    consent: context?.suppressed ? "Opted out (STOP)" : context?.smsConsent ? "SMS consent on file" : "No SMS consent",
    blockedReason: block?.message ?? null,
    fields: {
      first_name: lead.name.trim().split(/\s+/)[0] ?? null,
      rep_name: access?.displayName?.trim().split(/\s+/)[0] ?? null,
      company_name: company?.name ?? null,
    },
  };
}
