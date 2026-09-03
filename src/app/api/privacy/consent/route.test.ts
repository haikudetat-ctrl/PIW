import {describe, expect, test, vi} from "vitest";
import type {NextRequest} from "next/server";
import {signConsentCookie, type VerifiedConsent} from "@/modules/privacy/consent";
import {PrivacyConsentRateLimitError} from "@/modules/privacy/consent-repository";
import {handlePrivacyConsentRequest, handlePrivacyConsentStatusRequest} from "./route";

const signingSecret = "0123456789abcdef0123456789abcdef";

function request(body: unknown, headers?: HeadersInit) {
  return new Request("https://example.test/api/privacy/consent", {
    method: "POST",
    headers: {"content-type": "application/json", origin: "https://example.test", ...headers},
    body: JSON.stringify(body),
  }) as NextRequest;
}

function statusRequest(cookie?: string, headers?: HeadersInit) {
  return new Request("https://example.test/api/privacy/consent", {
    headers: { ...(cookie ? {cookie} : {}), ...headers },
  }) as NextRequest;
}

function dependencies(record = vi.fn(async () => undefined)) {
  return {
    signingSecret,
    deploymentEnvironment: "production" as const,
    requestIp: "127.0.0.1",
    now: () => new Date("2026-08-28T12:00:00Z"),
    createId: () => "11111111-1111-4111-8111-111111111111",
    repository: {record},
  };
}

describe("privacy consent route", () => {
  test("records consent and writes the secure cookie", async () => {
    const record = vi.fn(async () => undefined);
    const response = await handlePrivacyConsentRequest(request({
      analytics: true,
      advertising: false,
      gpcDetected: false,
      source: "banner",
    }), dependencies(record));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("piw_privacy=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      consentId: "11111111-1111-4111-8111-111111111111",
      policyVersion: "piw-privacy-v1",
      preferences: {necessary: true, analytics: true, advertising: false},
      requestIp: "127.0.0.1",
    }));
  });

  test("GPC cannot persist advertising consent", async () => {
    const response = await handlePrivacyConsentRequest(request({
      analytics: true,
      advertising: true,
      gpcDetected: true,
      source: "gpc",
    }), dependencies());

    expect(await response.json()).toMatchObject({
      consent: {preferences: {advertising: false}},
    });
  });

  test("server GPC cannot be bypassed by a false body value", async () => {
    const record = vi.fn(async () => undefined);
    const response = await handlePrivacyConsentRequest(request({
      analytics: true,
      advertising: true,
      gpcDetected: false,
      source: "banner",
    }, {"sec-gpc": "1"}), dependencies(record));

    expect(await response.json()).toMatchObject({
      consent: {gpcDetected: true, preferences: {advertising: false}},
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      gpcDetected: true,
      preferences: {necessary: true, analytics: true, advertising: false},
    }));
  });

  test("reuses only a verified server cookie consent identity", async () => {
    const record = vi.fn(async () => undefined);
    const existingConsentId = "22222222-2222-4222-8222-222222222222";
    const existingCookie = signConsentCookie({
      consentId: existingConsentId,
      preferences: {necessary: true, analytics: false, advertising: false},
      gpcDetected: false,
      updatedAt: "2026-08-27T12:00:00.000Z",
    }, signingSecret);
    const response = await handlePrivacyConsentRequest(request({
      analytics: true, advertising: false, gpcDetected: false, source: "preferences",
    }, {cookie: `piw_privacy=${existingCookie}`}), dependencies(record));

    expect(response.status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({consentId: existingConsentId}));
  });

  test("rejects unknown fields", async () => {
    const response = await handlePrivacyConsentRequest(request({
      analytics: false, advertising: false, gpcDetected: false,
      source: "banner", leadId: "not-accepted",
    }), dependencies());
    expect(response.status).toBe(400);
  });

  test.each([null, "https://attacker.example"])(
    "rejects an unsafe browser Origin before any consent write (%s)",
    async (origin) => {
      const record = vi.fn(async () => undefined);
      const headers = new Headers({"content-type": "application/json"});
      if (origin) headers.set("origin", origin);
      const unsafe = new Request("https://example.test/api/privacy/consent", {
        method: "POST",
        headers,
        body: JSON.stringify({analytics: false, advertising: false, gpcDetected: false, source: "banner"}),
      }) as NextRequest;

      const response = await handlePrivacyConsentRequest(unsafe, dependencies(record));

      expect(response.status).toBe(403);
      expect(record).not.toHaveBeenCalled();
    },
  );

  test("returns the atomic database rate limit without setting a new consent cookie", async () => {
    const response = await handlePrivacyConsentRequest(request({
      analytics: true, advertising: true, gpcDetected: false, source: "preferences",
    }), dependencies(vi.fn(async () => { throw new PrivacyConsentRateLimitError(); })));

    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("retry-after")).toBe("3600");
  });

  test("does not write a cookie when persistence fails", async () => {
    const response = await handlePrivacyConsentRequest(request({
      analytics: false, advertising: false, gpcDetected: false, source: "banner",
    }), dependencies(vi.fn(async () => { throw new Error("database unavailable"); })));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("returns 503 when signing is unavailable", async () => {
    const unavailable = {...dependencies(), signingSecret: undefined};
    const response = await handlePrivacyConsentRequest(request({
      analytics: false, advertising: false, gpcDetected: false, source: "banner",
    }), unavailable);

    expect(response.status).toBe(503);
    expect(unavailable.repository.record).not.toHaveBeenCalled();
  });

  test("returns the current canonical revocation rather than a stale PIW grant", async () => {
    const token = signConsentCookie({
      consentId: "22222222-2222-4222-8222-222222222222",
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:00:00.000Z",
    }, signingSecret);
    const revoked: VerifiedConsent = {
      consentId: "22222222-2222-4222-8222-222222222222",
      policyVersion: "piw-privacy-v1" as const,
      preferences: {necessary: true, analytics: false, advertising: false},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:01:00.000Z",
    };
    const readCurrent = vi.fn(async () => revoked);

    const response = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`),
      {
        signingSecret,
        deploymentEnvironment: "production",
        requestIp: null,
        now: () => new Date("2026-08-28T12:01:00.000Z"),
        createId: () => "33333333-3333-4333-8333-333333333333",
        repository: {record: vi.fn(async () => undefined), readCurrent},
      },
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("piw_privacy=");
    await expect(response.json()).resolves.toMatchObject({consent: {
      consentId: "22222222-2222-4222-8222-222222222222",
      preferences: {advertising: false},
      updatedAt: "2026-08-28T12:01:00.000Z",
    }});
    expect(readCurrent).toHaveBeenCalledWith({
      consentId: "22222222-2222-4222-8222-222222222222",
      policyVersion: "piw-privacy-v1",
    });
  });

  test("fails closed in status when current consent is unavailable or GPC is active", async () => {
    const token = signConsentCookie({
      consentId: "22222222-2222-4222-8222-222222222222",
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:00:00.000Z",
    }, signingSecret);
    const grant: VerifiedConsent = {
      consentId: "22222222-2222-4222-8222-222222222222",
      policyVersion: "piw-privacy-v1" as const,
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:01:00.000Z",
    };
    const gpcRecord = vi.fn(async () => undefined);
    const unavailable = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`),
      {
        signingSecret,
        deploymentEnvironment: "test",
        requestIp: null,
        now: () => new Date("2026-08-28T12:01:00.000Z"),
        createId: () => "33333333-3333-4333-8333-333333333333",
        repository: {record: vi.fn(async () => undefined), readCurrent: vi.fn(async () => null)},
      },
    );
    const gpc = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`, {"x-all-season-gpc": "1"}),
      {
        signingSecret,
        deploymentEnvironment: "test",
        requestIp: null,
        now: () => new Date("2026-08-28T12:01:00.000Z"),
        createId: () => "33333333-3333-4333-8333-333333333333",
        repository: {record: gpcRecord, readCurrent: vi.fn(async () => grant)},
      },
    );

    await expect(unavailable.json()).resolves.toMatchObject({consent: {
      preferences: {advertising: false},
    }});
    expect(unavailable.headers.get("set-cookie")).toBeNull();
    await expect(gpc.json()).resolves.toMatchObject({consent: {
      gpcDetected: true,
      preferences: {advertising: false},
    }});
    expect(gpcRecord).toHaveBeenCalledWith(expect.objectContaining({
      consentId: "22222222-2222-4222-8222-222222222222",
      gpcDetected: true,
      preferences: {necessary: true, analytics: true, advertising: false},
      source: "gpc",
    }));
  });
});
