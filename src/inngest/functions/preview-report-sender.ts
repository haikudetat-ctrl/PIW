import { z } from "zod";
import { summarizeRoofForPreview } from "@/domain/roof-complexity";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { inngest, propertyPreviewReportRequested } from "@/inngest/client";
import { signPreviewLink } from "@/modules/property-preview/preview-links";
import type { PreviewReportKind } from "@/modules/property-preview/preview-report-email";
import { sendPreviewReport, type SendPreviewReportDependencies } from "@/modules/property-preview/send-preview-report";
import { findVerifiedPublicHost } from "@/modules/property-preview/supabase-preview-repository";
import { publicBrandSchema } from "@/modules/tenancy/public-host";

const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const segmentsSchema = z.array(z.object({pitchDegrees: z.number(), areaSqft: z.number()}));

function createDependencies(): SendPreviewReportDependencies | null {
  const environment = parseServerEnv(process.env);
  const apiKey = environment.RESEND_API_KEY;
  const fromEmail = environment.PREVIEW_REPORT_FROM_EMAIL;
  const secret = environment.ROOF_ASSESSMENT_SIGNING_SECRET;
  if (!apiKey || !fromEmail || !secret) return null;
  const client = createServiceClient();
  let brandName = "All Season Solar";

  return {
    async loadPreview({companyId, previewId}) {
      const {data, error} = await client
        .from("property_previews")
        .select("status, expires_at, saved_email, saved_email_normalized, unsubscribed_at, reminders_sent, canonical_address, submitted_address")
        .eq("company_id", companyId)
        .eq("id", previewId)
        .maybeSingle();
      if (error) throw new Error("Failed to load preview for report");
      if (!data) return null;
      return {
        status: data.status,
        expiresAt: data.expires_at,
        savedEmail: data.saved_email,
        savedEmailNormalized: data.saved_email_normalized,
        unsubscribedAt: data.unsubscribed_at,
        remindersSent: data.reminders_sent,
        address: data.canonical_address ?? data.submitted_address,
      };
    },
    async loadRoof({companyId, previewId}) {
      const {data} = await client
        .from("property_previews")
        .select("measurement_status, roof_insight_id")
        .eq("company_id", companyId)
        .eq("id", previewId)
        .maybeSingle();
      if (data?.measurement_status !== "ready" || !data.roof_insight_id) return null;
      const {data: insight} = await client
        .from("roof_insights")
        .select("total_roof_sqft, roof_segments")
        .eq("company_id", companyId)
        .eq("id", data.roof_insight_id)
        .eq("lookup_status", "success")
        .maybeSingle();
      const segments = segmentsSchema.safeParse(insight?.roof_segments);
      if (!insight?.total_roof_sqft || !segments.success) return null;
      return summarizeRoofForPreview({totalRoofSqft: Number(insight.total_roof_sqft), roofSegments: segments.data});
    },
    async isSuppressed({companyId, emailNormalized}) {
      const {data} = await client
        .from("property_preview_email_suppressions")
        .select("email_normalized")
        .eq("company_id", companyId)
        .eq("email_normalized", emailNormalized)
        .maybeSingle();
      return Boolean(data);
    },
    async resolveHost(companyId) {
      const host = await findVerifiedPublicHost(client, companyId);
      if (host) {
        const {data} = await client.from("company_public_hosts").select("brand").eq("host", host).maybeSingle();
        const brand = publicBrandSchema.safeParse(data?.brand);
        if (brand.success) brandName = brand.data.displayName;
      }
      return host;
    },
    get brandName() {
      return brandName;
    },
    signLink: (purpose, previewId) => signPreviewLink(purpose, previewId, secret),
    async sendEmail({to, subject, text, oneClickUnsubscribeUrl, idempotencyKey}) {
      const response = await fetch(RESEND_EMAIL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: `${brandName} <${fromEmail}>`,
          to: [to],
          subject,
          text,
          headers: {
            "List-Unsubscribe": `<${oneClickUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Resend responded with ${response.status}`);
    },
    async markReminderSent({companyId, previewId, remindersSent}) {
      const {error} = await client
        .from("property_previews")
        .update({reminders_sent: remindersSent, updated_at: new Date().toISOString()})
        .eq("company_id", companyId)
        .eq("id", previewId);
      if (error) throw new Error("Failed to record preview reminder");
    },
  };
}

async function send(companyId: string, previewId: string, kind: PreviewReportKind) {
  const dependencies = createDependencies();
  if (!dependencies) {
    console.info("property_preview_report", {kind, outcome: "not_configured"});
    return {outcome: "not_configured" as const};
  }
  const result = await sendPreviewReport({companyId, previewId, kind}, dependencies);
  console.info("property_preview_report", {kind, outcome: result.outcome});
  return result;
}

/** Sends the report the homeowner just asked for. */
export const previewReportSender = inngest.createFunction(
  {id: "property-preview-report-sender", triggers: {event: propertyPreviewReportRequested}, retries: 3},
  async ({event, step}) => step.run("send-report", () => send(event.data.companyId, event.data.previewId, "report")),
);

/** One reminder sequence per preview: after 24 hours, then 3 days later. */
export const previewReportReminders = inngest.createFunction(
  {
    id: "property-preview-report-reminders",
    triggers: {event: propertyPreviewReportRequested},
    idempotency: "event.data.previewId",
    retries: 3,
  },
  async ({event, step}) => {
    await step.sleep("wait-for-first-reminder", "24h");
    await step.run("send-reminder-1", () => send(event.data.companyId, event.data.previewId, "reminder_1"));
    await step.sleep("wait-for-second-reminder", "72h");
    await step.run("send-reminder-2", () => send(event.data.companyId, event.data.previewId, "reminder_2"));
  },
);

/** Marks overdue previews expired and clears old rate buckets. */
export const propertyPreviewExpiry = inngest.createFunction(
  {id: "property-preview-expiry", triggers: {cron: "17 4 * * *"}},
  async () => {
    const {data, error} = await createServiceClient().rpc("expire_property_previews");
    if (error) throw new Error("Failed to expire property previews");
    return {expired: data};
  },
);
