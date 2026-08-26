import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { campaignSlugs } from "@/config/campaigns";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  acceptAllSeasonCampaignEstimate,
  type AllSeasonCampaignEstimateLeadInput,
} from "@/modules/leads/accept-all-season-campaign-estimate";
import { signContinuation } from "@/modules/roof-assessment/continuation-token";
import { startOrResumeRoofAssessment } from "@/modules/roof-assessment/start-or-resume";
import { SupabaseAssessmentIntakeRepository } from "@/modules/roof-assessment/supabase-assessment-intake-repository";

const nullableAttribution = z.string().trim().max(500).nullable();
const campaignSchema = z.enum(campaignSlugs);
const presentationSchema = z.enum(["all-season-main", ...campaignSlugs]);
const entryPointSchema = z.enum([
  "main-home",
  "main-contact",
  "main-drawer",
  ...campaignSlugs.map((campaign) => `campaign:${campaign}` as const),
]);

export const allSeasonCampaignEstimateSchema = z.strictObject({
  submission_id: z.uuid(),
  campaign: campaignSchema.nullable(),
  presentation_key: presentationSchema,
  entry_point: entryPointSchema,
  name: z.string().trim().min(2).max(160),
  email: z.email().max(320),
  phone: z.string().trim().min(7).max(40),
  source: z.literal("all-season-campaign"),
  submittedAt: z.iso.datetime({offset: true}),
  disclosure_version: z.literal("all-season-campaign-estimate-v1"),
  client_ip_address: z.union([z.ipv4(), z.ipv6()]),
  client_user_agent: z.string().trim().min(1).max(1000),
  referrer: z.url().max(2_000).nullable(),
  attribution: z.strictObject({
    utm_source: nullableAttribution,
    utm_medium: nullableAttribution,
    utm_campaign: nullableAttribution,
    utm_term: nullableAttribution,
    utm_content: nullableAttribution,
    fbclid: nullableAttribution,
    fbp: nullableAttribution,
    fbc: nullableAttribution,
  }),
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
  if (!input.google_place_id) {
    if (!input.address_line_1 || !input.city || input.state !== "NJ" || !input.postal_code) {
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "A complete New Jersey address is required without a Google Place ID",
      });
    }
  }

  if (input.entry_point.startsWith("campaign:")) {
    const routeCampaign = input.entry_point.slice("campaign:".length);
    if (input.campaign !== routeCampaign || input.presentation_key !== routeCampaign) {
      context.addIssue({
        code: "custom",
        path: ["entry_point"],
        message: "Campaign context must match",
      });
    }
    return;
  }

  if (input.campaign !== null || input.presentation_key !== "all-season-main") {
    context.addIssue({
      code: "custom",
      path: ["presentation_key"],
      message: "Main-site context must use the All Season presentation",
    });
  }
});

export type AllSeasonCampaignEstimateInput = z.infer<
  typeof allSeasonCampaignEstimateSchema
>;

export function toCampaignEstimateLeadInput(
  input: AllSeasonCampaignEstimateInput,
): AllSeasonCampaignEstimateLeadInput {
  return {
    submissionId: input.submission_id,
    campaign: input.campaign,
    presentationKey: input.presentation_key,
    entryPoint: input.entry_point,
    name: input.name,
    email: input.email,
    phone: input.phone,
    submittedAddress: input.address,
    googlePlaceId: input.google_place_id ?? undefined,
    clientIpAddress: input.client_ip_address,
    clientUserAgent: input.client_user_agent,
    submittedAt: input.submittedAt,
    disclosureVersion: input.disclosure_version,
    referrer: input.referrer,
    attribution: input.attribution,
  };
}

type CampaignEstimateDependencies = {
  expectedSecret: string;
  accept: (
    payload: AllSeasonCampaignEstimateInput,
  ) => ReturnType<typeof acceptAllSeasonCampaignEstimate>;
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
    const result = await dependencies.accept(parsed.data);
    if (result.kind === "duplicate_requires_restart") {
      return NextResponse.json(
        {error: "Please restart this estimate request.", retryable: true},
        {status: 409},
      );
    }
    return NextResponse.json(
      {accepted: true, continuationPath: result.continuationPath},
      {status: 202},
    );
  } catch {
    return NextResponse.json(
      { error: "Campaign estimate intake is temporarily unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const environment = parseServerEnv(process.env);
  if (
    !environment.ROOF_ASSESSMENT_ENABLED
    || !environment.ROOF_ASSESSMENT_SIGNING_SECRET
    || !environment.ALL_SEASON_INTAKE_SHARED_SECRET
    || !environment.ALL_SEASON_INTAKE_COMPANY_ID
  ) {
    return NextResponse.json(
      { error: "All Season campaign estimate intake is not configured" },
      { status: 503 },
    );
  }

  const service = createServiceClient();
  const repository = new SupabaseAssessmentIntakeRepository(service);
  const signingKey = environment.ROOF_ASSESSMENT_SIGNING_SECRET;
  const companyId = environment.ALL_SEASON_INTAKE_COMPANY_ID;

  return handleAllSeasonCampaignEstimateRequest(request, {
    expectedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
    accept: (payload) => acceptAllSeasonCampaignEstimate(
      toCampaignEstimateLeadInput(payload),
      {
        companyId,
        startAssessment: (input) => startOrResumeRoofAssessment(input, {
          repository,
          tokenIssuer: {
            issue: (capability) => signContinuation(capability, signingKey),
          },
        }),
      },
    ),
  });
}
