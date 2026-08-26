import { z } from "zod";

export const canonicalCampaignSlugs = [
  "weather-report",
  "seasonal-shield",
  "for-every-season",
] as const;

const nullableAttribution = z.string().trim().max(500).nullable();
const campaignSchema = z.enum(canonicalCampaignSlugs);
const presentationSchema = z.enum(["all-season-main", ...canonicalCampaignSlugs]);
const entryPointSchema = z.enum([
  "main-home",
  "main-contact",
  "main-drawer",
  ...canonicalCampaignSlugs.map((campaign) => `campaign:${campaign}` as const),
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
