import {z} from "zod";
import {landingSlugs} from "@/config/campaigns";

const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const websiteArrivalSchema = z.strictObject({
  occurred_at: z.iso.datetime({offset: true}),
  request_path: boundedText(500),
  campaign_slug: z.enum(landingSlugs).nullish(),
  visitor_hash: z.string().regex(/^[0-9a-f]{64}$/),
  user_agent: boundedText(1_000).nullish(),
  referrer_host: boundedText(255).nullish(),
  fbclid: boundedText(500).nullish(),
  utm_source: boundedText(500).nullish(),
  utm_medium: boundedText(500).nullish(),
  utm_campaign: boundedText(500).nullish(),
  utm_content: boundedText(500).nullish(),
  utm_term: boundedText(500).nullish(),
  meta_placement: boundedText(200).nullish(),
  meta_site_source: boundedText(200).nullish(),
  is_likely_bot: z.boolean(),
  // Quote flow that served the arrival; absent means legacy.
  experiment_arm: z.enum(["legacy", "value_first"]).optional(),
  // Google/Microsoft Ads click IDs and ValueTrack values. Sent by the website
  // only once AD_ATTRIBUTION_FORWARDING_ENABLED is on.
  gclid: boundedText(512).nullish(),
  gbraid: boundedText(512).nullish(),
  wbraid: boundedText(512).nullish(),
  msclkid: boundedText(512).nullish(),
  gad_source: boundedText(50).nullish(),
  gad_campaignid: boundedText(50).nullish(),
  google_campaign_id: boundedText(50).nullish(),
  google_ad_group_id: boundedText(50).nullish(),
  google_keyword: boundedText(200).nullish(),
  google_match_type: boundedText(20).nullish(),
  google_creative_id: boundedText(50).nullish(),
  google_target_id: boundedText(100).nullish(),
  google_device: boundedText(20).nullish(),
  google_network: boundedText(20).nullish(),
  google_loc_physical_ms: boundedText(50).nullish(),
});

/** Arrivals are batched by the beacon so a burst of traffic costs one request, not one per hit. */
export const websiteArrivalBatchSchema = z.strictObject({
  arrivals: z.array(websiteArrivalSchema).min(1).max(50),
});

export type WebsiteArrivalInput = z.infer<typeof websiteArrivalSchema>;
