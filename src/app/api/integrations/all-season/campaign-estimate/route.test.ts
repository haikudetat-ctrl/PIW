import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import {
  handleAllSeasonCampaignEstimateRequest,
  toCampaignEstimateRpcArgs,
  toCampaignEstimateLeadInput,
  type AllSeasonCampaignEstimateInput,
} from "./route";

const validPayload = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  campaign: "do-it-right-once" as const,
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
  address: "1 Main St, Newark, NJ 07102, USA",
  google_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  address_line_1: "1 Main St",
  address_line_2: null,
  city: "Newark",
  state: "NJ" as const,
  postal_code: "07102",
  consent_to_contact: true as const,
  consent_to_process_property: true as const,
  source: "all-season-campaign" as const,
  submittedAt: "2026-08-24T14:00:00.000Z",
  client_ip_address: "203.0.113.10",
  client_user_agent: "homeowner-browser",
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

function request(body: unknown, secret = "shared-secret") {
  return new NextRequest(
    "https://piw.example/api/integrations/all-season/campaign-estimate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-all-season-intake-secret": secret,
      },
      body: JSON.stringify(body),
    },
  );
}

const accepted = {
  leadId: "22222222-2222-4222-8222-222222222222",
  publicToken: "33333333-3333-4333-8333-333333333333",
  resultPath: "/roof-estimate/33333333-3333-4333-8333-333333333333",
};

describe("All Season campaign estimate intake", () => {
  test("maps the website proxy payload to the estimate creation contract", () => {
    const parsed = validPayload satisfies AllSeasonCampaignEstimateInput;

    expect(toCampaignEstimateLeadInput(parsed)).toEqual({
      submissionId: validPayload.submission_id,
      campaign: "do-it-right-once",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      submittedAddress: validPayload.address,
      googlePlaceId: validPayload.google_place_id,
      clientIpAddress: validPayload.client_ip_address,
      clientUserAgent: validPayload.client_user_agent,
      submittedAt: validPayload.submittedAt,
      attribution: validPayload.attribution,
    });
  });

  test("maps a campaign lead to the atomic Supabase transaction", () => {
    const parsed = validPayload satisfies AllSeasonCampaignEstimateInput;

    expect(toCampaignEstimateRpcArgs({
      input: toCampaignEstimateLeadInput(parsed),
      companyId: "99999999-9999-4999-8999-999999999999",
    })).toEqual({
      p_company_id: "99999999-9999-4999-8999-999999999999",
      p_submission_id: validPayload.submission_id,
      p_name: validPayload.name,
      p_phone: validPayload.phone,
      p_email: validPayload.email,
      p_submitted_address: validPayload.address,
      p_campaign_slug: validPayload.campaign,
      p_submitted_at: validPayload.submittedAt,
      p_attribution: validPayload.attribution,
      p_disclosure_version: "all-season-campaign-estimate-v1",
      p_ip_address: validPayload.client_ip_address,
      p_user_agent: validPayload.client_user_agent,
      p_correlation_id: validPayload.submission_id,
      p_pipeline_version: 2,
      p_google_place_id: validPayload.google_place_id,
    });
  });

  test("rejects a request with the wrong shared secret", async () => {
    const accept = vi.fn();

    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload, "wrong-secret"),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(401);
    expect(accept).not.toHaveBeenCalled();
  });

  test("accepts a normalized Google address and returns the estimate continuation", async () => {
    const accept = vi.fn(async () => accepted);

    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, ...accepted });
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      campaign: "do-it-right-once",
      address: validPayload.address,
      google_place_id: validPayload.google_place_id,
    }));
  });

  test("accepts a complete manual New Jersey address without a Place ID", async () => {
    const accept = vi.fn(async () => accepted);
    const manualPayload = {
      ...validPayload,
      campaign: "weather-report",
      address: "1 Main St, Unit 2, Newark, NJ 07102",
      google_place_id: null,
      address_line_2: "Unit 2",
    };

    const response = await handleAllSeasonCampaignEstimateRequest(
      request(manualPayload),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(202);
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      address: manualPayload.address,
      google_place_id: null,
      state: "NJ",
      postal_code: "07102",
    }));
  });

  test.each([
    [{ ...validPayload, campaign: "twenty-year" }, "campaign whitelist"],
    [{ ...validPayload, consent_to_contact: false }, "contact consent"],
    [{ ...validPayload, consent_to_process_property: false }, "property consent"],
    [
      {
        ...validPayload,
        google_place_id: null,
        address_line_1: null,
        city: null,
        state: null,
        postal_code: null,
      },
      "manual address",
    ],
    [
      {
        ...validPayload,
        consent_to_contact: undefined,
        consent_to_process_property: undefined,
        consent_estimate: true,
        consent_email: true,
        consent_sms: true,
      },
      "legacy consent contract",
    ],
  ] as const)("rejects an invalid %s (%s)", async (payload, label) => {
    const accept = vi.fn();

    const response = await handleAllSeasonCampaignEstimateRequest(
      request(payload),
      { expectedSecret: "shared-secret", accept },
    );

    expect(label.length).toBeGreaterThan(0);
    expect(response.status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });

  test("returns a retryable response when estimate creation fails", async () => {
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        accept: async () => {
          throw new Error("database unavailable");
        },
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Campaign estimate intake is temporarily unavailable",
    });
  });
});
