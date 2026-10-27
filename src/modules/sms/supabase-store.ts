import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SmsStatus } from "./rules";
import type { InboundDeps, StatusDeps } from "./webhooks";

type Service = SupabaseClient<Database>;

// Leads keep the phone as typed; match the common US spellings of a number.
export function phoneVariants(e164: string): string[] {
  const national = e164.replace(/^\+1/, "");
  if (!/^[0-9]{10}$/.test(national)) return [e164];
  const [area, prefix, line] = [national.slice(0, 3), national.slice(3, 6), national.slice(6)];
  return [e164, national, `1${national}`, `(${area}) ${prefix}-${line}`, `${area}-${prefix}-${line}`, `${area}.${prefix}.${line}`];
}

export function createSmsWebhookStore(service: Service, companyId: string): InboundDeps & StatusDeps {
  function assertCompany(candidate: string) {
    if (!companyId || candidate !== companyId) throw new Error("SMS company mismatch");
  }
  assertCompany(companyId);
  return {
    async findCompanyByNumber(toE164) {
      const { data } = await service
        .from("company_sms_settings")
        .select("company_id")
        .eq("company_id", companyId)
        .eq("from_e164", toE164)
        .maybeSingle();
      return data?.company_id ?? null;
    },
    async findLeadByPhone(companyId, fromE164) {
      assertCompany(companyId);
      const variants = phoneVariants(fromE164);
      const list = variants.map((value) => `"${value}"`).join(",");
      const { data } = await service
        .from("leads")
        .select("id")
        .eq("company_id", companyId)
        .or(`phone_e164.eq.${fromE164},phone.in.(${list})`)
        .order("is_test", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0]?.id ?? null;
    },
    async insertInbound(row) {
      assertCompany(row.company_id);
      const { error } = await service.from("sms_messages").upsert(row, { onConflict: "provider_sid", ignoreDuplicates: true });
      if (error) throw new Error(`Failed to record inbound text: ${error.message}`);
    },
    async suppress(companyId, phoneE164) {
      assertCompany(companyId);
      const { error } = await service.from("suppression_list").insert({
        company_id: companyId,
        channel: "sms",
        phone_e164: phoneE164,
        reason: "Replied STOP",
        source_system: "twilio_sms",
      });
      // Already suppressed is fine.
      if (error && error.code !== "23505") throw new Error(`Failed to record opt-out: ${error.message}`);
    },
    async unsuppress(companyId, phoneE164) {
      assertCompany(companyId);
      const { error } = await service
        .from("suppression_list")
        .delete()
        .eq("company_id", companyId)
        .eq("channel", "sms")
        .eq("phone_e164", phoneE164)
        .eq("source_system", "twilio_sms");
      if (error) throw new Error(`Failed to record opt-in: ${error.message}`);
    },
    async findBySid(sid) {
      const { data } = await service.from("sms_messages").select("id, status").eq("company_id", companyId).eq("provider_sid", sid).maybeSingle();
      return data ? { id: data.id, status: data.status as SmsStatus } : null;
    },
    async updateStatus(id, status, errorCode) {
      const { error } = await service
        .from("sms_messages")
        .update({ status, error_code: errorCode, status_updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", id);
      if (error) throw new Error(`Failed to update text status: ${error.message}`);
    },
  };
}

export function smsWebhookUrls(requestUrl: string, path: string, productionHost: string | undefined): string[] {
  const urls = [requestUrl];
  if (productionHost) urls.push(`https://${productionHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}${path}`);
  return [...new Set(urls)];
}
