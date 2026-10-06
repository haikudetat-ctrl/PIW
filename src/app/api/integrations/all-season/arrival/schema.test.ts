import {describe, expect, test} from "vitest";
import {websiteArrivalSchema} from "./schema";

const arrival = {
  occurred_at: "2026-10-06T15:00:00.000Z",
  request_path: "/campaigns/roof-replacement",
  campaign_slug: "roof-replacement",
  visitor_hash: "a".repeat(64),
  user_agent: "Mozilla/5.0",
  referrer_host: "www.google.com",
  fbclid: null,
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "123",
  utm_content: null,
  utm_term: "roof replacement",
  meta_placement: null,
  meta_site_source: null,
  is_likely_bot: false,
};

describe("websiteArrivalSchema", () => {
  test("accepts a Google Ads arrival on the roof-replacement campaign", () => {
    const parsed = websiteArrivalSchema.parse({...arrival, gclid: "Cj0KCQ", wbraid: "w-1"});
    expect(parsed).toMatchObject({campaign_slug: "roof-replacement", gclid: "Cj0KCQ", wbraid: "w-1"});
  });

  test("still accepts arrivals from a website deploy that predates click-ID capture", () => {
    expect(websiteArrivalSchema.safeParse(arrival).success).toBe(true);
  });

  test("rejects an oversized click ID", () => {
    expect(websiteArrivalSchema.safeParse({...arrival, gclid: "x".repeat(501)}).success).toBe(false);
  });
});
