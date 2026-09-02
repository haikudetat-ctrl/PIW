import {NextRequest} from "next/server";
import {describe, expect, test, vi} from "vitest";
import {signConsentCookie, type VerifiedConsent} from "@/modules/privacy/consent";
import {PrivacyConsentRateLimitError} from "@/modules/privacy/consent-repository";
import {handleCurrentPrivacyConsentSyncRequest} from "./route";

const signingSecret = "0123456789abcdef0123456789abcdef";
const sharedSecret = "all-season-server-secret";
const consentId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-01T16:05:00.000Z");

const grantedConsent: VerifiedConsent = {
  policyVersion: "piw-privacy-v1",
  consentId,
  preferences: {necessary: true, analytics: true, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};

function request(token: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://piw.example/api/privacy/consent/current", {
    method: "POST",
    headers: {
      origin: "https://allseasonsolar.net",
      "x-all-season-intake-secret": sharedSecret,
      "x-piw-privacy-consent": token,
      ...headers,
    },
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const canonical = grantedConsent;
  return {
    signingSecret,
    expectedSharedSecret: sharedSecret,
    now: () => now,
    createId: () => "22222222-2222-4222-8222-222222222222",
    isAllowedWebsiteOrigin: (origin: string) => origin === "https://allseasonsolar.net",
    requestIp: "203.0.113.7",
    repository: {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn(async () => canonical),
    },
    ...overrides,
  };
}

describe("current privacy consent sync endpoint", () => {
  test("records a newer signed website preference and returns only its canonical state", async () => {
    const canonical: VerifiedConsent = {
      ...grantedConsent,
      updatedAt: now.toISOString(),
    };
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(canonical),
    };
    const token = signConsentCookie(grantedConsent, signingSecret);

    const response = await handleCurrentPrivacyConsentSyncRequest(
      request(token),
      dependencies({repository}),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({consent: canonical});
    expect(repository.record).toHaveBeenCalledWith({
      evidenceId: "22222222-2222-4222-8222-222222222222",
      consentId,
      policyVersion: "piw-privacy-v1",
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      source: "preferences",
      requestIp: "203.0.113.7",
      userAgent: "",
      occurredAt: grantedConsent.updatedAt,
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  test("returns a newer canonical revocation instead of replaying a stale signed grant", async () => {
    const revoked: VerifiedConsent = {
      ...grantedConsent,
      preferences: {...grantedConsent.preferences, advertising: false},
      updatedAt: "2026-09-01T16:03:00.000Z",
    };
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn(async () => revoked),
    };

    const response = await handleCurrentPrivacyConsentSyncRequest(
      request(signConsentCookie(grantedConsent, signingSecret)),
      dependencies({repository}),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({consent: revoked});
    expect(repository.record).not.toHaveBeenCalled();
  });

  test("GPC on the sync request records denied Advertising even for a signed grant", async () => {
    const canonical: VerifiedConsent = {
      ...grantedConsent,
      preferences: {...grantedConsent.preferences, advertising: false},
      gpcDetected: true,
      updatedAt: now.toISOString(),
    };
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(canonical),
    };

    const response = await handleCurrentPrivacyConsentSyncRequest(
      request(signConsentCookie(grantedConsent, signingSecret), {"sec-gpc": "1"}),
      dependencies({repository}),
    );

    expect(response.status).toBe(200);
    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: true,
      source: "gpc",
      occurredAt: now.toISOString(),
    }));
  });

  test("GPC cannot be superseded by an equal-time canonical grant", async () => {
    const equalTimeGrant: VerifiedConsent = {
      ...grantedConsent,
      updatedAt: now.toISOString(),
    };
    const revoked: VerifiedConsent = {
      ...equalTimeGrant,
      preferences: {...equalTimeGrant.preferences, advertising: false},
      gpcDetected: true,
      updatedAt: now.toISOString(),
    };
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn()
        .mockResolvedValueOnce(equalTimeGrant)
        .mockResolvedValueOnce(revoked),
    };

    const response = await handleCurrentPrivacyConsentSyncRequest(
      request(signConsentCookie(grantedConsent, signingSecret), {"sec-gpc": "1"}),
      dependencies({repository}),
    );

    await expect(response.json()).resolves.toEqual({consent: revoked});
    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({
      gpcDetected: true,
      preferences: {necessary: true, analytics: true, advertising: false},
    }));
  });

  test("records an equal-time non-GPC denial instead of retaining a grant", async () => {
    const equalTimeGrant = {...grantedConsent, updatedAt: now.toISOString()};
    const denied: VerifiedConsent = {
      ...equalTimeGrant,
      preferences: {...equalTimeGrant.preferences, advertising: false},
    };
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn().mockResolvedValueOnce(equalTimeGrant).mockResolvedValueOnce(denied),
    };
    const token = signConsentCookie(denied, signingSecret);

    const response = await handleCurrentPrivacyConsentSyncRequest(request(token), dependencies({repository}));

    await expect(response.json()).resolves.toEqual({consent: denied});
    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({
      gpcDetected: false,
      preferences: expect.objectContaining({advertising: false}),
    }));
  });

  test("returns the atomic database rate limit for an authenticated website sync", async () => {
    const repository = {
      record: vi.fn(async () => { throw new PrivacyConsentRateLimitError(); }),
      readCurrent: vi.fn(async () => null),
    };
    const response = await handleCurrentPrivacyConsentSyncRequest(
      request(signConsentCookie(grantedConsent, signingSecret)), dependencies({repository}),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
  });

  test("requires the website runtime to forward a validated visitor IP", async () => {
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn(async () => grantedConsent),
    };
    const response = await handleCurrentPrivacyConsentSyncRequest(
      request(signConsentCookie(grantedConsent, signingSecret)),
      dependencies({repository, requestIp: null}),
    );

    expect(response.status).toBe(503);
    expect(repository.readCurrent).not.toHaveBeenCalled();
  });

  test.each([
    ["a missing server credential", request(signConsentCookie(grantedConsent, signingSecret), {"x-all-season-intake-secret": ""})],
    ["an untrusted origin", request(signConsentCookie(grantedConsent, signingSecret), {origin: "https://attacker.example"})],
    ["an invalid consent token", request("invalid")],
  ])("rejects %s without reading or recording consent", async (_label, incoming) => {
    const repository = {
      record: vi.fn(async () => undefined),
      readCurrent: vi.fn(async () => grantedConsent),
    };

    const response = await handleCurrentPrivacyConsentSyncRequest(
      incoming,
      dependencies({repository}),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({error: "Privacy consent is unavailable"});
    expect(repository.readCurrent).not.toHaveBeenCalled();
    expect(repository.record).not.toHaveBeenCalled();
  });
});
