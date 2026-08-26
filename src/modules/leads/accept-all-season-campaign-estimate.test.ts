import { expect, test, vi } from "vitest";
import { acceptAllSeasonCampaignEstimate } from "./accept-all-season-campaign-estimate";

const payload = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  campaign: "weather-report" as const,
  presentationKey: "weather-report" as const,
  entryPoint: "campaign:weather-report" as const,
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
  submittedAddress: "1 Main St, Newark, NJ 07102, USA",
  googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  clientIpAddress: "203.0.113.10",
  clientUserAgent: "homeowner-browser",
  submittedAt: "2026-08-24T14:00:00.000Z",
  disclosureVersion: "all-season-campaign-estimate-v1",
  referrer: "https://allseason.example/campaigns/weather-report",
  attribution: {
    utm_source: "facebook",
    utm_medium: "paid-social",
    utm_campaign: "20y",
    utm_term: null,
    utm_content: "receipt",
    fbclid: "click-123",
    fbp: "fb.1.100.200",
    fbc: "fb.1.100.click",
  },
};

test("forwards the complete campaign intake evidence to the canonical assessment service", async () => {
  const startAssessment = vi.fn(async () => ({
    kind: "continue" as const,
    continuationPath: "/roof-estimate/continue/signed_token-123" as const,
  }));

  const result = await acceptAllSeasonCampaignEstimate(payload, {
    companyId: "99999999-9999-4999-8999-999999999999",
    startAssessment,
  });

  expect(result).toEqual({
    kind: "continue",
    continuationPath: "/roof-estimate/continue/signed_token-123",
  });
  expect(startAssessment).toHaveBeenCalledWith({
    submissionId: payload.submissionId,
    companyId: "99999999-9999-4999-8999-999999999999",
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    submittedAddress: payload.submittedAddress,
    googlePlaceId: payload.googlePlaceId,
    campaign: "weather-report",
    presentationKey: "weather-report",
    entryPoint: "campaign:weather-report",
    attribution: payload.attribution,
    referrer: payload.referrer,
    consent: {
      disclosureVersion: "all-season-campaign-estimate-v1",
      ipAddress: payload.clientIpAddress,
      userAgent: payload.clientUserAgent,
      grantedAt: payload.submittedAt,
    },
  });
});

test("preserves the restart-only duplicate result without inventing a continuation", async () => {
  const result = await acceptAllSeasonCampaignEstimate(payload, {
    companyId: "99999999-9999-4999-8999-999999999999",
    startAssessment: async () => ({kind: "duplicate_requires_restart"}),
  });

  expect(result).toEqual({kind: "duplicate_requires_restart"});
  expect(result).not.toHaveProperty("continuationPath");
  expect(result).not.toHaveProperty("leadId");
  expect(result).not.toHaveProperty("publicToken");
});
