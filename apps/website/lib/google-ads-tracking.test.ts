import {describe, expect, test} from "vitest";
import {websiteGoogleAdsConfig} from "./google-ads-tracking";

const complete = {
  NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED: "true",
  NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "AW-123456789",
  NEXT_PUBLIC_GOOGLE_ADS_LEAD_CONVERSION_LABEL: "AbC-dEf_123",
  PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
};

describe("website Google Ads configuration", () => {
  test("enables only a complete privacy-aware browser configuration", () => {
    expect(websiteGoogleAdsConfig(complete)).toEqual({
      tagId: "AW-123456789",
      leadConversionLabel: "AbC-dEf_123",
    });
  });

  test.each([
    ["the flag is off", {NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED: "false"}],
    ["the tag is not an Ads tag", {NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "G-ABC123"}],
    ["the conversion label is missing", {NEXT_PUBLIC_GOOGLE_ADS_LEAD_CONVERSION_LABEL: ""}],
    ["the conversion label is malformed", {NEXT_PUBLIC_GOOGLE_ADS_LEAD_CONVERSION_LABEL: "bad label<"}],
    ["the signing secret is short", {PRIVACY_CONSENT_SIGNING_SECRET: "short"}],
    ["the signing secret is missing", {PRIVACY_CONSENT_SIGNING_SECRET: undefined}],
  ])("stays off when %s", (_reason, override) => {
    expect(websiteGoogleAdsConfig({...complete, ...override})).toBeNull();
  });
});
