import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createEventEnvelope } from "@/domain/events";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueAndPublishEvent } from "@/modules/events/enqueue-and-publish-event";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { acceptAllSeasonIntake } from "@/modules/leads/accept-all-season-intake";

const nullableAttribution = z.string().trim().max(500).nullable();

export const allSeasonIntakeSchema = z.object({
  submission_id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  email: z.email(),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(500),
  project_interest: z.enum(["roofing", "solar", "both"]),
  consent_to_contact: z.literal(true),
  consent_to_process_property: z.literal(true),
  source: z.literal("all-season-website"),
  submittedAt: z.iso.datetime(),
  attribution: z.object({
    fbclid: nullableAttribution,
    fbp: nullableAttribution,
    fbc: nullableAttribution,
  }),
});

export type AllSeasonIntake = z.infer<typeof allSeasonIntakeSchema>;

type IntakeDependencies = {
  expectedSecret: string;
  accept: (payload: AllSeasonIntake) => Promise<{ leadId: string; duplicate: boolean }>;
  reportError?: (error: unknown) => void;
};

function secretsMatch(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return actual.length > 0 && expected.length > 0 && timingSafeEqual(digest(actual), digest(expected));
}

export async function handleAllSeasonIntakeRequest(
  request: NextRequest,
  dependencies: IntakeDependencies,
) {
  const providedSecret = request.headers.get("x-all-season-intake-secret") ?? "";
  if (!secretsMatch(providedSecret, dependencies.expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = allSeasonIntakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid lead submission" }, { status: 400 });
  }

  try {
    const accepted = await dependencies.accept(parsed.data);
    return NextResponse.json({ accepted: true, ...accepted }, { status: 202 });
  } catch (error) {
    (dependencies.reportError ?? console.error)(error);
    return NextResponse.json({ error: "Lead intake is temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const environment = parseServerEnv(process.env);
  if (!environment.ALL_SEASON_INTAKE_SHARED_SECRET || !environment.ALL_SEASON_INTAKE_COMPANY_ID) {
    return NextResponse.json({ error: "All Season intake is not configured" }, { status: 503 });
  }

  const companyId = environment.ALL_SEASON_INTAKE_COMPANY_ID;
  const service = createServiceClient();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";

  return handleAllSeasonIntakeRequest(request, {
    expectedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
    accept: (payload) =>
      acceptAllSeasonIntake(
        {
          submissionId: payload.submission_id,
          name: payload.name,
          email: payload.email,
          phone: payload.phone,
          submittedAddress: payload.address,
          serviceRequested: payload.project_interest,
          submittedAt: payload.submittedAt,
          attribution: payload.attribution,
        },
        {
          createLeadRecords: async (lead) => {
            const { data, error } = await service.rpc("submit_all_season_lead", {
              p_company_id: companyId,
              p_submission_id: lead.externalLeadId,
              p_name: lead.name,
              p_phone: lead.phone,
              p_email: lead.email,
              p_submitted_address: lead.submittedAddress,
              p_service_requested: lead.serviceRequested,
              p_submitted_at: lead.submittedAt,
              p_attribution: lead.attribution,
              p_disclosure_version: lead.disclosureVersion,
              p_ip_address: forwardedFor,
              p_user_agent: userAgent,
              p_pipeline_version: 2,
              p_phone_e164: lead.phoneE164 ?? "",
              p_email_normalized: lead.emailNormalized,
            });
            if (error) {
              console.error("All Season Supabase RPC failed", {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
              });
              throw new Error("Failed to create All Season lead");
            }
            if (!data?.[0]) throw new Error("All Season lead RPC returned no rows");
            return {
              leadId: data[0].lead_id,
              propertyId: data[0].property_id,
              pipelineRunId: data[0].pipeline_run_id,
              duplicate: data[0].is_duplicate,
            };
          },
          enqueueLeadSubmitted: async (lead) => {
            const event = createEventEnvelope({
              name: "crm/lead.submitted",
              correlationId: lead.correlationId,
              pipelineRunId: lead.pipelineRunId,
              leadId: lead.leadId,
              propertyId: lead.propertyId,
              data: {
                leadId: lead.leadId,
                propertyId: lead.propertyId,
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                submittedAddress: lead.submittedAddress,
                serviceRequested: lead.serviceRequested,
                notes: "Submitted through the All Season website quote form.",
              },
            });
            await enqueueAndPublishEvent({
              repository: new SupabaseOutboxRepository(service),
              event,
              companyId,
              send: (outbound) => inngest.send(outbound),
            });
          },
        },
      ),
  });
}
