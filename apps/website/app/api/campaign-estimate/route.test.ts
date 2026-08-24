import {NextRequest} from "next/server";
import {afterEach, describe, expect, test, vi} from "vitest";
import {handleCampaignEstimateRequest, POST} from "./route";

const submissionId = "11111111-1111-4111-8111-111111111111";
const publicAppUrl = "https://piw.example/";

afterEach(() => {
  delete process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL;
  delete process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  delete process.env.PIW_PUBLIC_APP_URL;
  vi.unstubAllGlobals();
});

function request(body: unknown, cookie = "_fbp=fb.1.100.200; _fbc=fb.1.100.click") {
  return new NextRequest("https://allseason.example/api/campaign-estimate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "user-agent": "homeowner-browser",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

function googleSubmission(overrides: Record<string, unknown> = {}) {
  return {
    submission_id: submissionId,
    campaign: "do-it-right-once",
    name: "Alex Rivera",
    email: "alex@example.com",
    phone: "201-555-0100",
    address: "1 Main St, Newark, NJ 07102, USA",
    google_place_id: "ChIJ-test-place",
    consent_to_contact: true,
    consent_to_process_property: true,
    utm_source: "facebook",
    utm_medium: "paid-social",
    utm_campaign: "lifetime-roof",
    utm_content: "blue-hero",
    utm_term: "roof replacement",
    fbclid: "click-123",
    ...overrides,
  };
}

describe("campaign estimate proxy", () => {
  test("forwards a Google-normalized campaign lead with attribution and returns the PIW result URL", async () => {
    let forwarded: Record<string, unknown> | undefined;
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async (payload) => {
        forwarded = payload;
        return Response.json({accepted: true, resultPath: "/roof-estimate/22222222-2222-4222-8222-222222222222"}, {status: 202});
      },
      publicAppUrl,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      estimateUrl: "https://piw.example/roof-estimate/22222222-2222-4222-8222-222222222222",
    });
    expect(forwarded).toEqual(expect.objectContaining({
      submission_id: submissionId,
      campaign: "do-it-right-once",
      source: "all-season-campaign",
      address: "1 Main St, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-test-place",
      client_ip_address: "203.0.113.10",
      client_user_agent: "homeowner-browser",
      attribution: {
        utm_source: "facebook",
        utm_medium: "paid-social",
        utm_campaign: "lifetime-roof",
        utm_content: "blue-hero",
        utm_term: "roof replacement",
        fbclid: "click-123",
        fbp: "fb.1.100.200",
        fbc: "fb.1.100.click",
      },
    }));
    expect(typeof forwarded?.submittedAt).toBe("string");
  });

  test("accepts a complete manual New Jersey address and formats it for PIW", async () => {
    let forwarded: Record<string, unknown> | undefined;
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission({
        campaign: "weather-report",
        address: "ignored browser display value",
        google_place_id: null,
        address_line_1: "12 Birch Street",
        address_line_2: null,
        city: "Newark",
        state: "NJ",
        postal_code: "07102",
      })),
      async (payload) => {
        forwarded = payload;
        return Response.json({accepted: true, publicToken: "33333333-3333-4333-8333-333333333333"}, {status: 202});
      },
      publicAppUrl,
    );

    expect(response.status).toBe(202);
    expect(forwarded).toEqual(expect.objectContaining({
      address: "12 Birch Street, Newark, NJ 07102",
      google_place_id: null,
      address_line_1: "12 Birch Street",
      address_line_2: null,
      city: "Newark",
      state: "NJ",
      postal_code: "07102",
    }));
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      estimateUrl: "https://piw.example/roof-estimate/33333333-3333-4333-8333-333333333333",
    });
  });

  test.each([
    ["an unknown campaign", googleSubmission({campaign: "not-a-campaign"})],
    ["a Google address without a place id", googleSubmission({google_place_id: undefined})],
    ["an incomplete manual address", googleSubmission({google_place_id: undefined, address_line_1: "12 Birch Street", city: "Newark"})],
    ["an address outside New Jersey", googleSubmission({google_place_id: undefined, address_line_1: "12 Birch Street", city: "Newark", state: "NY", postal_code: "07102"})],
    ["missing contact consent", googleSubmission({consent_to_contact: false})],
    ["missing property-processing consent", googleSubmission({consent_to_process_property: false})],
  ])("rejects %s without forwarding it", async (_label, body) => {
    const forward = vi.fn(async () => Response.json({accepted: true, publicToken: crypto.randomUUID()}));
    const response = await handleCampaignEstimateRequest(request(body), forward, publicAppUrl);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("preserves an upstream validation failure as a 400 response", async () => {
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async () => Response.json({error: "Address is outside the service area"}, {status: 400}),
      publicAppUrl,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({error: "Address is outside the service area"});
  });

  test.each([
    ["an upstream failure", async () => new Response(null, {status: 500})],
    ["a network failure", async () => { throw new Error("network down"); }],
    ["a malformed success", async () => Response.json({accepted: true}, {status: 202})],
    ["an unsafe result path", async () => Response.json({accepted: true, resultPath: "https://attacker.example/roof-estimate/fake"}, {status: 202})],
  ])("returns 502 for %s", async (_label, forward) => {
    const response = await handleCampaignEstimateRequest(request(googleSubmission()), forward, publicAppUrl);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({error: "Estimate intake is temporarily unavailable"});
  });

  test("POST authenticates the configured server-to-server request", async () => {
    process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL = "https://piw-internal.example/api/integrations/all-season/campaign-estimate";
    process.env.INTAKE_WEBHOOK_SHARED_SECRET = "shared-secret";
    process.env.PIW_PUBLIC_APP_URL = publicAppUrl;
    const fetch = vi.fn(async () => Response.json({accepted: true, publicToken: "44444444-4444-4444-8444-444444444444"}, {status: 202}));
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request(googleSubmission()));

    expect(response.status).toBe(202);
    expect(fetch).toHaveBeenCalledWith(
      "https://piw-internal.example/api/integrations/all-season/campaign-estimate",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-all-season-intake-secret": "shared-secret",
        },
        cache: "no-store",
      }),
    );
  });

  test("POST returns 503 when the server-to-server route is not fully configured", async () => {
    process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL = "https://piw-internal.example/api/integrations/all-season/campaign-estimate";

    const response = await POST(request(googleSubmission()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({error: "Estimate intake is not configured"});
  });
});
