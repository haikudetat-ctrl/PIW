import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import {
  handleAllSeasonCampaignEstimateRequest,
  toCampaignEstimateLeadInput,
  type AllSeasonCampaignEstimateInput,
} from "./route";

const validPayload = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  campaign: "weather-report" as const,
  presentation_key: "weather-report" as const,
  entry_point: "campaign:weather-report" as const,
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
  disclosure_version: "all-season-campaign-estimate-v1" as const,
  client_ip_address: "203.0.113.10",
  client_user_agent: "homeowner-browser",
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

describe("All Season campaign estimate intake", () => {
  test("maps every external evidence field to the canonical campaign adapter", () => {
    const parsed = validPayload satisfies AllSeasonCampaignEstimateInput;

    expect(toCampaignEstimateLeadInput(parsed)).toEqual({
      submissionId: validPayload.submission_id,
      campaign: "weather-report",
      presentationKey: "weather-report",
      entryPoint: "campaign:weather-report",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      submittedAddress: validPayload.address,
      googlePlaceId: validPayload.google_place_id,
      clientIpAddress: validPayload.client_ip_address,
      clientUserAgent: validPayload.client_user_agent,
      submittedAt: validPayload.submittedAt,
      disclosureVersion: validPayload.disclosure_version,
      referrer: validPayload.referrer,
      attribution: validPayload.attribution,
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

  test("returns only the canonical continuation path for a first issue", async () => {
    const accept = vi.fn(async () => ({
      kind: "continue" as const,
      continuationPath: "/roof-estimate/continue/signed_token-123" as const,
    }));
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      continuationPath: "/roof-estimate/continue/signed_token-123",
    });
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      campaign: "weather-report",
      presentation_key: "weather-report",
      entry_point: "campaign:weather-report",
    }));
  });

  test("accepts the canonical main-site framing without campaign attribution", async () => {
    const accept = vi.fn(async () => ({
      kind: "continue" as const,
      continuationPath: "/roof-estimate/continue/main_token" as const,
    }));
    const response = await handleAllSeasonCampaignEstimateRequest(
      request({
        ...validPayload,
        campaign: null,
        presentation_key: "all-season-main",
        entry_point: "main-drawer",
      }),
      {expectedSecret: "shared-secret", accept},
    );

    expect(response.status).toBe(202);
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      campaign: null,
      presentation_key: "all-season-main",
      entry_point: "main-drawer",
    }));
  });

  test("maps an idempotent replay to an explicit non-success restart response", async () => {
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        accept: async () => ({kind: "duplicate_requires_restart"}),
      },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Please restart this estimate request.",
      retryable: true,
    });
  });

  test.each([
    [{ ...validPayload, campaign: "do-it-right-once" }, "unknown campaign"],
    [{ ...validPayload, presentation_key: "seasonal-shield" }, "mismatched presentation"],
    [{ ...validPayload, entry_point: "campaign:seasonal-shield" }, "mismatched entry point"],
    [{ ...validPayload, consent_to_contact: false }, "contact consent"],
    [{ ...validPayload, consent_to_process_property: false }, "property consent"],
    [{ ...validPayload, client_ip_address: "not-an-ip" }, "client IP"],
    [{ ...validPayload, extra_secret: "must-not-pass" }, "unknown field"],
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

  test("returns a generic retryable response without leaking a dependency error", async () => {
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        accept: async () => {
          throw new Error("database host secret-123 alex@example.com");
        },
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toBe('{"error":"Campaign estimate intake is temporarily unavailable"}');
    expect(body).not.toContain("secret-123");
    expect(body).not.toContain("alex@example.com");
  });
});
