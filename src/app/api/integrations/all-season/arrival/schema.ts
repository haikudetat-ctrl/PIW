import {z} from "zod";

const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const websiteArrivalSchema = z.strictObject({
  occurred_at: z.iso.datetime({offset: true}),
  request_path: boundedText(500),
  campaign_slug: z.enum(["weather-report", "seasonal-shield", "for-every-season"]).nullish(),
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
});

/** Arrivals are batched by the beacon so a burst of traffic costs one request, not one per hit. */
export const websiteArrivalBatchSchema = z.strictObject({
  arrivals: z.array(websiteArrivalSchema).min(1).max(50),
});

export type WebsiteArrivalInput = z.infer<typeof websiteArrivalSchema>;
