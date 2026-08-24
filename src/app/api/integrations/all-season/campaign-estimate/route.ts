import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eventEnvelopeSchema } from "@/domain/events";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueAndPublishEvent } from "@/modules/events/enqueue-and-publish-event";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import {
  acceptAllSeasonCampaignEstimate,
  type AllSeasonCampaignEstimateLeadInput,
} from "@/modules/leads/accept-all-season-campaign-estimate";

const nullableAttribution = z.string().trim().max(500).nullable().optional().transform((value) => value ?? null);

const campaignEstimateBaseSchema = z.object({
  submission_id: z.uuid(),
  campaign: z.enum([
    "do-it-right-once",
    "weather-report",
    "seasonal-shield",
    "for-every-season",
  ]),
  name: z.string().trim().min(2).max(160),
  email: z.email().max(320),
  phone: z.string().trim().min(7).max(40),
  source: z.literal("all-season-campaign"),
  submittedAt: z.iso.datetime(),
  client_ip_address: z.string().trim().min(1).max(100),
  client_user_agent: z.string().trim().min(1).max(1000),
  attribution: z.object({
    utm_source: nullableAttribution,
    utm_medium: nullableAttribution,
    utm_campaign: nullableAttribution,
    utm_term: nullableAttribution,
    utm_content: nullableAttribution,
    fbclid: nullableAttribution,
    fbp: nullableAttribution,
    fbc: nullableAttribution,
  }),
});

export const allSeasonCampaignEstimateSchema = z.intersection(
  campaignEstimateBaseSchema,
  z.object({
    address: z.string().trim().min(5).max(500),
    google_place_id: z.string().trim().min(1).max(300).nullable().optional(),
    address_line_1: z.string().trim().min(3).max(200).nullable().optional(),
    address_line_2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(2).max(160).nullable().optional(),
    state: z.literal("NJ").nullable().optional(),
    postal_code: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/).nullable().optional(),
    consent_to_contact: z.literal(true),
    consent_to_process_property: z.literal(true),
  }).superRefine((input, context) => {
    if (input.google_place_id) return;
    if (!input.address_line_1 || !input.city || input.state !== "NJ" || !input.postal_code) {
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "A complete New Jersey address is required without a Google Place ID",
      });
    }
  }),
);

export type AllSeasonCampaignEstimateInput = z.infer<
  typeof allSeasonCampaignEstimateSchema
>;

export function toCampaignEstimateLeadInput(
  input: AllSeasonCampaignEstimateInput,
): AllSeasonCampaignEstimateLeadInput {
  return {
    submissionId: input.submission_id,
    campaign: input.campaign,
    name: input.name,
    email: input.email,
    phone: input.phone,
    submittedAddress: input.address,
    googlePlaceId: input.google_place_id ?? undefined,
    clientIpAddress: input.client_ip_address,
    clientUserAgent: input.client_user_agent,
    submittedAt: input.submittedAt,
    attribution: input.attribution,
  };
}

export function toCampaignEstimateRpcArgs({
  input,
  companyId,
}: {
  input: AllSeasonCampaignEstimateLeadInput;
  companyId: string;
}) {
  return {
    p_company_id: companyId,
    p_submission_id: input.submissionId,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_submitted_address: input.submittedAddress,
    p_campaign_slug: input.campaign,
    p_submitted_at: input.submittedAt,
    p_attribution: input.attribution,
    p_disclosure_version: "all-season-campaign-estimate-v1",
    p_ip_address: input.clientIpAddress,
    p_user_agent: input.clientUserAgent,
    p_correlation_id: input.submissionId,
    p_pipeline_version: 2,
    p_google_place_id: input.googlePlaceId ?? "",
  };
}

type CampaignEstimateResult = {
  leadId: string;
  publicToken: string;
  resultPath: string;
};

type CampaignEstimateDependencies = {
  expectedSecret: string;
  accept: (payload: AllSeasonCampaignEstimateInput) => Promise<CampaignEstimateResult>;
};

function secretsMatch(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return actual.length > 0 && expected.length > 0 && timingSafeEqual(digest(actual), digest(expected));
}

export async function handleAllSeasonCampaignEstimateRequest(
  request: NextRequest,
  dependencies: CampaignEstimateDependencies,
) {
  const providedSecret = request.headers.get("x-all-season-intake-secret") ?? "";
  if (!secretsMatch(providedSecret, dependencies.expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = allSeasonCampaignEstimateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid campaign estimate submission" }, { status: 400 });
  }

  try {
    const accepted = await dependencies.accept(parsed.data);
    return NextResponse.json({ accepted: true, ...accepted }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "Campaign estimate intake is temporarily unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const environment = parseServerEnv(process.env);
  if (!environment.ALL_SEASON_INTAKE_SHARED_SECRET || !environment.ALL_SEASON_INTAKE_COMPANY_ID) {
    return NextResponse.json(
      { error: "All Season campaign estimate intake is not configured" },
      { status: 503 },
    );
  }

  const companyId = environment.ALL_SEASON_INTAKE_COMPANY_ID;
  const service = createServiceClient();

  return handleAllSeasonCampaignEstimateRequest(request, {
    expectedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
    accept: (payload) =>
      acceptAllSeasonCampaignEstimate(toCampaignEstimateLeadInput(payload), {
        createEstimateRecords: async (lead) => {
          const { data, error } = await service.rpc(
            "submit_all_season_campaign_estimate",
            toCampaignEstimateRpcArgs({
              input: lead,
              companyId,
            }),
          );
          const created = data?.[0];
          if (
            error ||
            !created?.lead_id ||
            !created.property_id ||
            !created.pipeline_run_id ||
            !created.public_token ||
            !created.event_id ||
            !created.event_payload
          ) {
            throw new Error("Failed to create All Season campaign estimate");
          }
          const event = eventEnvelopeSchema.parse(created.event_payload);
          if (event.id !== created.event_id) {
            throw new Error("All Season campaign estimate event identity mismatch");
          }
          return {
            leadId: created.lead_id,
            propertyId: created.property_id,
            pipelineRunId: created.pipeline_run_id,
            publicToken: created.public_token,
            event,
            isDuplicate: created.is_duplicate,
          };
        },
        publishPersistedLeadSubmitted: async (event) => {
          await enqueueAndPublishEvent({
            repository: new SupabaseOutboxRepository(service),
            event,
            companyId,
            send: (outbound) => inngest.send(outbound),
            eventAlreadyPersisted: true,
          });
        },
      }),
  });
}
