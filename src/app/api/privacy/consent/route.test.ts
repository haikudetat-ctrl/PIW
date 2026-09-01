import {describe, expect, test, vi} from "vitest";
import type {NextRequest} from "next/server";
import {signConsentCookie} from "@/modules/privacy/consent";
import {handlePrivacyConsentRequest} from "./route";

const signingSecret = "0123456789abcdef0123456789abcdef";

function request(body: unknown, headers?: HeadersInit) {
  return new Request("https://example.test/api/privacy/consent", {
    method: "POST",
    headers: {"content-type": "application/json", ...headers},
    body: JSON.stringify(body),
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
});
