import {NextRequest} from "next/server";
import {afterEach, describe, expect, test, vi} from "vitest";
import {allSeasonCampaignEstimateSchema} from "../../../../../src/app/api/integrations/all-season/campaign-estimate/schema";
import {signWebsiteConsent} from "../../../lib/privacy-consent";
import {handleCampaignEstimateRequest, POST} from "./route";

const submissionId = "11111111-1111-4111-8111-111111111111";
const publicAppUrl = "https://piw.example/";
const privacySigningSecret = "0123456789abcdef0123456789abcdef";
const privacyConsent = {
  policyVersion: "piw-privacy-v1" as const,
  consentId: "22222222-2222-4222-8222-222222222222",
  preferences: {necessary: true as const, analytics: false, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};

afterEach(() => {
  delete process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL;
  delete process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  delete process.env.PIW_PUBLIC_APP_URL;
  delete process.env.PRIVACY_CONSENT_SIGNING_SECRET;
  vi.unstubAllGlobals();
});

function request(
  body: unknown,
  cookie = "_fbp=fb.1.100.200; _fbc=fb.1.100.click",
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://allseason.example/api/campaign-estimate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      referer: "https://allseason.example/campaigns/weather-report?utm_source=facebook",
      "user-agent": "homeowner-browser",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
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
    campaign: "weather-report",
    presentation_key: "weather-report",
    entry_point: "campaign:weather-report",
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
  test("forwards consent and places only the signed handoff on the redirect", async () => {
    const consentToken = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const forward = vi.fn(async () => Response.json({
      accepted: true,
      continuationPath: "/roof-estimate/continue/signed-continuation-value",
    }, {status: 202}));

    const response = await handleCampaignEstimateRequest(
      request(googleSubmission(), `_fbp=fb.1.100.200; piw_privacy=${consentToken}`),
      forward,
      publicAppUrl,
      "production",
      privacySigningSecret,
      () => new Date("2026-09-01T16:00:00.000Z"),
      async ({localConsent}) => localConsent,
    );

    expect(forward).toHaveBeenCalledWith(expect.anything(), {consentToken});
    const body = await response.json() as {estimateUrl: string};
    const url = new URL(body.estimateUrl);
    expect(url.searchParams.get("privacy_handoff")).toEqual(expect.any(String));
    expect(url.search).not.toContain("advertising=true");
    expect(url.searchParams.size).toBe(1);
  });

  test("omits consent forwarding and handoff for an invalid cookie", async () => {
    const forward = vi.fn(async () => Response.json({
      accepted: true,
      continuationPath: "/roof-estimate/continue/safe-token",
    }, {status: 202}));

    const response = await handleCampaignEstimateRequest(
      request(googleSubmission(), "piw_privacy=invalid"),
      forward,
      publicAppUrl,
      "production",
      privacySigningSecret,
      () => new Date("2026-09-01T16:00:00.000Z"),
      async ({localConsent}) => localConsent,
    );

    expect(forward).toHaveBeenCalledOnce();
    expect(forward.mock.calls[0]).toHaveLength(1);
    const body = await response.json() as {estimateUrl: string};
    expect(new URL(body.estimateUrl).search).toBe("");
  });

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
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      estimateUrl: "https://piw.example/roof-estimate/continue/signed_token-123",
      metaEvent: null,
    });
    expect(forwarded).toEqual(expect.objectContaining({
      submission_id: submissionId,
      campaign: "weather-report",
      presentation_key: "weather-report",
      entry_point: "campaign:weather-report",
      source: "all-season-campaign",
      address: "1 Main St, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-test-place",
      client_ip_address: "203.0.113.10",
      client_user_agent: "homeowner-browser",
      referrer: "https://allseason.example/campaigns/weather-report?utm_source=facebook",
      disclosure_version: "all-season-campaign-estimate-v1",
      attribution: {
        utm_source: "facebook",
        utm_medium: "paid-social",
        utm_campaign: "lifetime-roof",
        utm_content: "blue-hero",
        utm_term: "roof replacement",
        fbclid: "click-123",
        fbp: null,
        fbc: null,
      },
    }));
    expect(typeof forwarded?.submittedAt).toBe("string");
    expect(allSeasonCampaignEstimateSchema.safeParse(forwarded).success).toBe(true);
    expect(forwarded).not.toHaveProperty("utm_source");
    expect(forwarded).not.toHaveProperty("utm_medium");
    expect(forwarded).not.toHaveProperty("utm_campaign");
    expect(forwarded).not.toHaveProperty("utm_term");
    expect(forwarded).not.toHaveProperty("utm_content");
    expect(forwarded).not.toHaveProperty("fbclid");
  });

  test("forwards Meta attribution only with verified advertising consent", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    let forwarded: Record<string, unknown> | undefined;

    const response = await handleCampaignEstimateRequest(
      request(googleSubmission(), `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`),
      async (payload) => {
        forwarded = payload;
        return Response.json({
          accepted: true,
          continuationPath: "/roof-estimate/continue/safe-token",
        }, {status: 202});
      },
      publicAppUrl,
      "production",
      privacySigningSecret,
      () => new Date("2026-09-01T16:00:00.000Z"),
      async ({localConsent}) => localConsent,
    );

    expect(response.status).toBe(202);
    expect(forwarded).toEqual(expect.objectContaining({
      attribution: expect.objectContaining({
        fbp: "fb.1.100.200",
        fbc: "fb.1.100.click",
      }),
    }));
  });

  test("keeps estimate delivery available but withholds residual Meta identifiers and the handoff when canonical consent is unavailable", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const forward = vi.fn(async () => Response.json({
      accepted: true,
      continuationPath: "/roof-estimate/continue/safe-token",
    }, {status: 202}));
    const resolveCanonical = vi.fn(async () => null);

    const response = await handleCampaignEstimateRequest(
      request(googleSubmission(), `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`),
      forward,
      publicAppUrl,
      "production",
      privacySigningSecret,
      () => new Date("2026-09-01T16:00:00.000Z"),
      resolveCanonical,
    );

    expect(response.status).toBe(202);
    expect(resolveCanonical).toHaveBeenCalledOnce();
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      attribution: expect.objectContaining({fbp: null, fbc: null}),
    }));
    expect(forward.mock.calls[0]).toHaveLength(1);
    const body = await response.json() as {estimateUrl: string};
    expect(new URL(body.estimateUrl).search).toBe("");
  });

  test("accepts Meta identifiers and a handoff only after a canonical current grant", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    let forwarded: Record<string, unknown> | undefined;

    const response = await handleCampaignEstimateRequest(
      request(googleSubmission(), `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`),
      async (payload) => {
        forwarded = payload;
        return Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe-token"}, {status: 202});
      },
      publicAppUrl,
      "production",
      privacySigningSecret,
      () => new Date("2026-09-01T16:00:00.000Z"),
      async ({localConsent}) => localConsent,
    );

    expect(response.status).toBe(202);
    expect(forwarded).toEqual(expect.objectContaining({
      attribution: expect.objectContaining({fbp: "fb.1.100.200", fbc: "fb.1.100.click"}),
    }));
    const body = await response.json() as {estimateUrl: string};
    expect(new URL(body.estimateUrl).searchParams.get("privacy_handoff")).toEqual(expect.any(String));
  });

  test("returns a PIW-issued Lead envelope without synthesizing one", async () => {
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      async () => Response.json({
        accepted: true,
        continuationPath: "/roof-estimate/continue/signed_token-123",
        metaEvent: {
          name: "Lead",
          eventId: "33333333-3333-4333-8333-333333333333",
          issuedAt: "2026-09-01T16:01:00.000Z",
        },
      }, {status: 202}),
      publicAppUrl,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      estimateUrl: "https://piw.example/roof-estimate/continue/signed_token-123",
      metaEvent: {
        name: "Lead",
        eventId: "33333333-3333-4333-8333-333333333333",
        issuedAt: "2026-09-01T16:01:00.000Z",
      },
    });
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
      metaEvent: null,
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
    ["the retired do-it-right-once campaign", googleSubmission({campaign:"do-it-right-once",presentation_key:"do-it-right-once",entry_point:"campaign:do-it-right-once"})],
    ["a Google address without a place id", googleSubmission({google_place_id: undefined})],
    ["an incomplete manual address", googleSubmission({google_place_id: undefined, address_line_1: "12 Birch Street", city: "Newark"})],
    ["an address outside New Jersey", googleSubmission({google_place_id: undefined, address_line_1: "12 Birch Street", city: "Newark", state: "NY", postal_code: "07102"})],
    ["missing contact consent", googleSubmission({consent_to_contact: false})],
    ["missing property-processing consent", googleSubmission({consent_to_process_property: false})],
    ["mismatched campaign framing", googleSubmission({presentation_key: "seasonal-shield"})],
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
    expect(response.headers.get("cache-control")).toBe("no-store");
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
    const forward = vi.fn(async () => Response.json({
      accepted: true,
      continuationPath: "/roof-estimate/continue/safe_token",
    }, {status: 202}));
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      forward,
      "http://piw.example",
      "production",
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(forward).not.toHaveBeenCalled();
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
      metaEvent: null,
    });
  });

  test.each([
    "https://user:password@piw.example/",
    "https://piw.example/app/",
    "https://piw.example/?tenant=other",
    "https://piw.example/#fragment",
  ])("rejects a configured value that is not an exact PIW origin", async (configuredOrigin) => {
    const forward = vi.fn(async () => Response.json({
      accepted: true,
      continuationPath: "/roof-estimate/continue/safe_token",
    }, {status: 202}));
    const response = await handleCampaignEstimateRequest(
      request(googleSubmission()),
      forward,
      configuredOrigin,
      "production",
    );

    expect(response.status).toBe(502);
    expect(forward).not.toHaveBeenCalled();
  });

  test("POST authenticates the configured server-to-server request", async () => {
    process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL = "https://piw-internal.example/api/integrations/all-season/campaign-estimate";
    process.env.INTAKE_WEBHOOK_SHARED_SECRET = "shared-secret";
    process.env.PIW_PUBLIC_APP_URL = publicAppUrl;
    process.env.PRIVACY_CONSENT_SIGNING_SECRET = privacySigningSecret;
    const consentToken = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input: RequestInfo | URL) => {
      if (String(input) === "https://piw.example/api/privacy/consent/current") {
        return Response.json({consent: privacyConsent});
      }
      return Response.json({accepted: true, continuationPath: "/roof-estimate/continue/safe_token"}, {status: 202});
    });
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request(
      googleSubmission(),
      `piw_privacy=${consentToken}`,
      {"x-vercel-oidc-token": "signed-preview-token"},
    ));

    expect(response.status).toBe(202);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://piw.example/api/privacy/consent/current");
    expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        origin: "https://allseason.example",
        "x-all-season-intake-secret": "shared-secret",
        "x-piw-privacy-consent": consentToken,
        "x-vercel-trusted-oidc-idp-token": "signed-preview-token",
      }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://piw-internal.example/api/integrations/all-season/campaign-estimate",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-all-season-intake-secret": "shared-secret",
          "x-piw-privacy-consent": consentToken,
          "x-vercel-trusted-oidc-idp-token": "signed-preview-token",
        },
        cache: "no-store",
      }),
    );
  });

  test("POST returns 503 when the server-to-server route is not fully configured", async () => {
    process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL = "https://piw-internal.example/api/integrations/all-season/campaign-estimate";

    const response = await POST(request(googleSubmission()));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({error: "Estimate intake is not configured"});
  });
});
