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
      referer: "https://allseason.example/campaigns/do-it-right-once?utm_source=facebook",
      "user-agent": "homeowner-browser",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

function requestWithHeaders(body: unknown, headers: Record<string, string>) {
  return new NextRequest("https://allseason.example/api/campaign-estimate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "homeowner-browser",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function googleSubmission(overrides: Record<string, unknown> = {}) {
  return {
    submission_id: submissionId,
    campaign: "do-it-right-once",
    presentation_key: "do-it-right-once",
    entry_point: "campaign:do-it-right-once",
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
        return Response.json({accepted: true, continuationPath: "/roof-estimate/continue/signed_token-123"}, {status: 202});
      },
      publicAppUrl,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      estimateUrl: "https://piw.example/roof-estimate/continue/signed_token-123",
    });
    expect(forwarded).toEqual(expect.objectContaining({
      submission_id: submissionId,
      campaign: "do-it-right-once",
      presentation_key: "do-it-right-once",
      entry_point: "campaign:do-it-right-once",
      source: "all-season-campaign",
      address: "1 Main St, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-test-place",
      client_ip_address: "203.0.113.10",
      client_user_agent: "homeowner-browser",
      referrer: "https://allseason.example/campaigns/do-it-right-once?utm_source=facebook",
      disclosure_version: "all-season-campaign-estimate-v1",
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
        presentation_key: "weather-report",
        entry_point: "campaign:weather-report",
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
        return Response.json({accepted: true, continuationPath: "/roof-estimate/continue/other_token-456"}, {status: 202});
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
      estimateUrl: "https://piw.example/roof-estimate/continue/other_token-456",
    });
  });

  test("accepts the canonical main-site framing for the shared homepage transport", async () => {
    let forwarded: Record<string, unknown> | undefined;
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission({
        campaign: null,
        presentation_key: "all-season-main",
        entry_point: "main-home",
      })),
      async (payload) => {
        forwarded = payload;
        return Response.json({accepted: true, continuationPath: "/roof-estimate/continue/main_token"}, {status: 202});
      },
      publicAppUrl,
    );

    expect(response.status).toBe(202);
    expect(forwarded).toEqual(expect.objectContaining({
      campaign: null,
      presentation_key: "all-season-main",
      entry_point: "main-home",
    }));
  });

  test.each([
    ["an unknown campaign", googleSubmission({campaign: "not-a-campaign"})],
    ["a Google address without a place id", googleSubmission({google_place_id: undefined})],
    ["an incomplete manual address", googleSubmission({google_place_id: undefined, address_line_1: "12 Birch Street", city: "Newark"})],
    ["an address outside New Jersey", googleSubmission({google_place_id: undefined, address_line_1: "12 Birch Street", city: "Newark", state: "NY", postal_code: "07102"})],
    ["missing contact consent", googleSubmission({consent_to_contact: false})],
    ["missing property-processing consent", googleSubmission({consent_to_process_property: false})],
    ["mismatched campaign framing", googleSubmission({presentation_key: "weather-report"})],
    ["an unknown field", googleSubmission({raw_secret: "must-not-pass"})],
  ])("rejects %s without forwarding it", async (_label, body) => {
    const forward = vi.fn(async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe_token"}));
    const response = await handleCampaignEstimateRequest(request(body), forward, publicAppUrl);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test.each([
    ["a malformed client IP", {"x-forwarded-for": "not-an-ip"}],
    ["an oversized user agent", {"user-agent": "x".repeat(1_001)}],
    ["a malformed referrer", {referer: "not a URL"}],
  ])("rejects %s before forwarding", async (_label, headers) => {
    const forward = vi.fn(async () => Response.json({
      accepted: true,
      continuationPath: "/roof-estimate/continue/safe_token",
    }));
    const response = await handleCampaignEstimateRequest(
      requestWithHeaders(googleSubmission(), headers),
      forward,
      publicAppUrl,
    );

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
    await expect(response.json()).resolves.toEqual({error: "Invalid estimate submission"});
  });

  test("maps a duplicate replay to an explicit retry response without reading its body", async () => {
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async () => Response.json({error: "raw upstream detail", attemptId: crypto.randomUUID()}, {status: 409}),
      publicAppUrl,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Please restart this estimate request.",
      retryable: true,
    });
  });

  test.each([
    ["an upstream failure", async () => new Response(null, {status: 500})],
    ["a network failure", async () => { throw new Error("network down"); }],
    ["a malformed success", async () => Response.json({accepted: true}, {status: 202})],
    ["an absolute URL", async () => Response.json({accepted: true, continuationPath: "https://attacker.example/roof-estimate/continue/fake"}, {status: 202})],
    ["a protocol-relative URL", async () => Response.json({accepted: true, continuationPath: "//attacker.example/roof-estimate/continue/fake"}, {status: 202})],
    ["path traversal", async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/../admin"}, {status: 202})],
    ["an encoded separator", async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe%2Fadmin"}, {status: 202})],
    ["a query string", async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe?token=secret"}, {status: 202})],
    ["a fragment", async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe#fragment"}, {status: 202})],
    ["a non-continuation path", async () => Response.json({accepted: true, continuationPath: "/roof-estimate/22222222-2222-4222-8222-222222222222"}, {status: 202})],
    ["a legacy public token", async () => Response.json({accepted: true, publicToken: "33333333-3333-4333-8333-333333333333"}, {status: 202})],
    ["multiple response shapes", async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe", publicToken: "33333333-3333-4333-8333-333333333333"}, {status: 202})],
  ])("returns 502 for %s", async (_label, forward) => {
    const response = await handleCampaignEstimateRequest(request(googleSubmission()), forward, publicAppUrl);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({error: "Estimate intake is temporarily unavailable"});
  });

  test("rejects an insecure configured PIW origin in production", async () => {
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe_token"}, {status: 202}),
      "http://piw.example",
      "production",
    );

    expect(response.status).toBe(502);
  });

  test("allows an HTTP localhost PIW origin during development", async () => {
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe_token"}, {status: 202}),
      "http://localhost:3000",
      "development",
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      estimateUrl: "http://localhost:3000/roof-estimate/continue/safe_token",
    });
  });

  test.each([
    "https://user:password@piw.example/",
    "https://piw.example/app/",
    "https://piw.example/?tenant=other",
    "https://piw.example/#fragment",
  ])("rejects a configured value that is not an exact PIW origin", async (configuredOrigin) => {
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe_token"}, {status: 202}),
      configuredOrigin,
      "production",
    );

    expect(response.status).toBe(502);
  });

  test("POST authenticates the configured server-to-server request", async () => {
    process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL = "https://piw-internal.example/api/integrations/all-season/campaign-estimate";
    process.env.INTAKE_WEBHOOK_SHARED_SECRET = "shared-secret";
    process.env.PIW_PUBLIC_APP_URL = publicAppUrl;
    const fetch = vi.fn(async () => Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe_token"}, {status: 202}));
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
