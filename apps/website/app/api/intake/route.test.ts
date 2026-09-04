import {NextRequest} from "next/server";
import {afterEach, describe, expect, test, vi} from "vitest";
import {signWebsiteConsent} from "../../../lib/privacy-consent";
import {handleIntakeRequest, POST} from "./route";

const privacySigningSecret = "0123456789abcdef0123456789abcdef";
const privacyConsent = {
  policyVersion: "piw-privacy-v1" as const,
  consentId: "22222222-2222-4222-8222-222222222222",
  preferences: {necessary: true as const, analytics: false, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};

afterEach(() => {
  delete process.env.INTAKE_WEBHOOK_URL;
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
  return new NextRequest("https://rake.example/api/intake", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function acceptedResponse() {
  return Response.json({accepted: true, metaEvent: null}, {status: 202});
}

describe("lead intake proxy", () => {
  test("forwards verified consent only in the server-to-server consent header", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const forward = vi.fn<(
      payload: Record<string, unknown>,
      options?: {consentToken: string},
    ) => Promise<Response>>().mockResolvedValue(acceptedResponse());

    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "roofing",
        consent_to_contact: true,
        consent_to_process_property: true,
      }, `_fbp=fb.1.100.200; piw_privacy=${token}`),
      forward,
      privacySigningSecret,
      async ({localConsent}) => localConsent,
    );

    expect(response.status).toBe(202);
    expect(forward).toHaveBeenCalledWith(expect.anything(), {consentToken: token});
    expect(forward.mock.calls[0]?.[0]).not.toHaveProperty("privacyConsent");
  });

  test("captures Meta attribution and forwards a normalized lead", async () => {
    const forward = vi.fn(async () => acceptedResponse());
    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        google_place_id: "ChIJ-selected",
        project_interest: "both",
        consent_to_contact: true,
        consent_to_process_property: true,
        fbclid: "click-123",
      }),
      forward,
    );

    expect(response.status).toBe(202);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      submission_id: "11111111-1111-4111-8111-111111111111",
      source: "all-season-website",
      google_place_id: "ChIJ-selected",
      attribution: {fbclid: "click-123", fbp: null, fbc: null},
    }));
  });

  test("forwards Meta attribution only with verified advertising consent", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    let forwarded: Record<string, unknown> | undefined;
    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "both",
        consent_to_contact: true,
        consent_to_process_property: true,
      }, `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`),
      async (payload) => {
        forwarded = payload;
        return acceptedResponse();
      },
      privacySigningSecret,
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

  test("keeps the business intake available but withholds residual Meta identifiers when canonical consent cannot be resolved", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const forward = vi.fn(async () => acceptedResponse());
    const resolveCanonical = vi.fn(async () => null);

    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "both",
        consent_to_contact: true,
        consent_to_process_property: true,
      }, `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`),
      forward,
      privacySigningSecret,
      resolveCanonical,
    );

    expect(response.status).toBe(202);
    expect(resolveCanonical).toHaveBeenCalledOnce();
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      attribution: expect.objectContaining({fbp: null, fbc: null}),
    }));
    expect(forward.mock.calls[0]).toHaveLength(1);
  });

  test("uses only a canonical current grant before forwarding Meta identifiers", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    let forwarded: Record<string, unknown> | undefined;

    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "both",
        consent_to_contact: true,
        consent_to_process_property: true,
      }, `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`),
      async (payload) => {
        forwarded = payload;
        return acceptedResponse();
      },
      privacySigningSecret,
      async ({localConsent}) => localConsent,
    );

    expect(response.status).toBe(202);
    expect(forwarded).toEqual(expect.objectContaining({
      attribution: expect.objectContaining({fbp: "fb.1.100.200", fbc: "fb.1.100.click"}),
    }));
  });

  test("treats Sec-GPC as authoritative before reading residual Meta identifiers", async () => {
    const token = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const incoming = new NextRequest("https://rake.example/api/intake", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-gpc": "1",
        cookie: `_fbp=fb.1.100.200; _fbc=fb.1.100.click; piw_privacy=${token}`,
      },
      body: JSON.stringify({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "both",
        consent_to_contact: true,
        consent_to_process_property: true,
      }),
    });
    const resolver = vi.fn(async ({localConsent}: {localConsent: typeof privacyConsent}) => localConsent);
    const forward = vi.fn(async () => acceptedResponse());

    const response = await handleIntakeRequest(incoming, forward, privacySigningSecret, resolver);

    expect(response.status).toBe(202);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      localConsent: expect.objectContaining({
        gpcDetected: true,
        preferences: expect.objectContaining({advertising: false}),
      }),
    }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      attribution: expect.objectContaining({fbp: null, fbc: null}),
    }), expect.objectContaining({consentToken: expect.any(String)}));
  });

  test("returns only the PIW-issued Lead envelope", async () => {
    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "roofing",
        consent_to_contact: true,
        consent_to_process_property: true,
      }),
      async () => Response.json({
        accepted: true,
        leadId: "22222222-2222-4222-8222-222222222222",
        duplicate: false,
        metaEvent: {
          name: "QualifiedLead",
          eventId: "33333333-3333-4333-8333-333333333333",
          issuedAt: "2026-09-01T16:01:00.000Z",
        },
      }, {status: 202}),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      metaEvent: {
        name: "QualifiedLead",
        eventId: "33333333-3333-4333-8333-333333333333",
        issuedAt: "2026-09-01T16:01:00.000Z",
      },
    });
  });

  test("rejects an empty successful upstream response", async () => {
    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "roofing",
        consent_to_contact: true,
        consent_to_process_property: true,
      }),
      async () => new Response(null, {status: 202}),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Lead intake is temporarily unavailable",
    });
  });

  test("rejects invalid submissions without calling the webhook", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({name: ""}), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("requires explicit contact consent", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
      project_interest: "roofing",
      consent_to_contact: false,
      consent_to_process_property: true,
    }), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("requires explicit property-processing consent", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
      project_interest: "solar",
      consent_to_contact: true,
      consent_to_process_property: false,
    }), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("returns a retryable gateway error when intake fails", async () => {
    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "roofing",
        consent_to_contact: true,
        consent_to_process_property: true,
      }),
      async () => new Response(null, {status: 500}),
    );

    expect(response.status).toBe(502);
  });

  test("authenticates the server-to-server request with the All Season header", async () => {
    process.env.INTAKE_WEBHOOK_URL = "https://piw.example/api/integrations/all-season/intake";
    process.env.INTAKE_WEBHOOK_SHARED_SECRET = "shared-secret";
    process.env.PRIVACY_CONSENT_SIGNING_SECRET = privacySigningSecret;
    process.env.PIW_PUBLIC_APP_URL = "https://piw.example";
    const consentToken = signWebsiteConsent(privacyConsent, privacySigningSecret);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input: RequestInfo | URL) => {
      if (String(input) === "https://piw.example/api/privacy/consent/current") {
        return Response.json({consent: privacyConsent});
      }
      return acceptedResponse();
    });
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
      project_interest: "both",
      consent_to_contact: true,
      consent_to_process_property: true,
    }, `piw_privacy=${consentToken}`, {
      "x-vercel-oidc-token": "signed-preview-token",
    }));

    expect(response.status).toBe(202);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://piw.example/api/privacy/consent/current");
    expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        origin: "https://rake.example",
        "x-all-season-intake-secret": "shared-secret",
        "x-piw-privacy-consent": consentToken,
        "x-vercel-trusted-oidc-idp-token": "signed-preview-token",
      }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://piw.example/api/integrations/all-season/intake",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-all-season-intake-secret": "shared-secret",
          "x-piw-privacy-consent": consentToken,
          "x-vercel-trusted-oidc-idp-token": "signed-preview-token",
        }),
      }),
    );
  });
});
