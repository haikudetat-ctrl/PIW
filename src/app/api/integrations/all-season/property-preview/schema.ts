import { z } from "zod";
import { campaignSchema, entryPointSchema, presentationSchema } from "../campaign-estimate/schema";

const nullableAttribution = z.string().trim().max(500).nullable();

// The website forwards only what the homeowner typed or selected, plus the
// browser evidence it observed. Coordinates and measurements are never
// accepted from this transport.
export const allSeasonPropertyPreviewSchema = z.strictObject({
  address: z.string().trim().min(5).max(500),
  google_place_id: z.string().trim().min(1).max(300).nullable(),
  campaign: campaignSchema.nullable(),
  entry_point: entryPointSchema,
  presentation_key: presentationSchema,
  attribution: z.strictObject({
    utm_source: nullableAttribution,
    utm_medium: nullableAttribution,
    utm_campaign: nullableAttribution,
    utm_term: nullableAttribution,
    utm_content: nullableAttribution,
    fbclid: nullableAttribution,
    gclid: nullableAttribution.optional(),
    gbraid: nullableAttribution.optional(),
    wbraid: nullableAttribution.optional(),
  }),
  referrer: z.url().max(2_000).nullable(),
  client_ip_address: z.union([z.ipv4(), z.ipv6()]),
  client_user_agent: z.string().trim().min(1).max(1000),
  turnstile_token: z.string().min(1).max(2048),
}).superRefine((input, context) => {
  if (input.entry_point.startsWith("campaign:")) {
    const routeCampaign = input.entry_point.slice("campaign:".length);
    if (input.campaign !== routeCampaign || input.presentation_key !== routeCampaign) {
      context.addIssue({code: "custom", path: ["entry_point"], message: "Campaign context must match"});
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

export type AllSeasonPropertyPreviewInput = z.infer<typeof allSeasonPropertyPreviewSchema>;
