import {NextRequest} from "next/server";
import {describe, expect, test, vi} from "vitest";
import {readWebsiteConsent, signWebsiteConsent} from "../../../../lib/privacy-consent";
import {handlePrivacyConsentRequest, handlePrivacyConsentStatusRequest} from "./route";

const signingSecret = "0123456789abcdef0123456789abcdef";
const consentId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-01T16:00:00.000Z");

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://allseason.example/api/privacy/consent", {
    method: "POST",
    headers: {"content-type": "application/json", origin: "https://allseason.example", ...headers},
    body: JSON.stringify(body),
  });
}

function statusRequest(cookie?: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://allseason.example/api/privacy/consent", {
    headers: { ...(cookie ? {cookie} : {}), ...headers },
  });
}

describe("website privacy consent endpoint", () => {
  test("returns only a server-verified current consent snapshot", async () => {
    const token = signWebsiteConsent({
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: false, advertising: true},
      gpcDetected: false,
      updatedAt: now.toISOString(),
    }, signingSecret);

    const verified = await handlePrivacyConsentStatusRequest(statusRequest(`piw_privacy=${token}`), {
      signingSecret,
      now: () => now,
      synchronize: async () => ({
        policyVersion: "piw-privacy-v1",
        consentId,
        preferences: {necessary: true, analytics: false, advertising: true},
        gpcDetected: false,
        updatedAt: now.toISOString(),
      }),
    } as never);
    const invalid = await handlePrivacyConsentStatusRequest(
      statusRequest("piw_privacy=not-signed"),
      {signingSecret, now: () => now, synchronize: async () => null} as never,
    );

    expect(verified.headers.get("cache-control")).toBe("no-store");
    await expect(verified.json()).resolves.toMatchObject({consent: {
      consentId,
      preferences: {advertising: true},
    }});
    await expect(invalid.json()).resolves.toEqual({consent: null});
  });

  test("fails closed when the canonical PIW status cannot be synchronized", async () => {
    const token = signWebsiteConsent({
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: now.toISOString(),
    }, signingSecret);

    const response = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`),
      {
        signingSecret,
        now: () => now,
        synchronize: async () => null,
      } as never,
    );

    await expect(response.json()).resolves.toEqual({consent: {
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: false,
      updatedAt: now.toISOString(),
    }});
  });

  test("fails closed when canonical state belongs to a different consent identity", async () => {
    const token = signWebsiteConsent({
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: now.toISOString(),
    }, signingSecret);

    const response = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`),
      {
        signingSecret,
        now: () => now,
        synchronize: async () => ({
          policyVersion: "piw-privacy-v1",
          consentId: "22222222-2222-4222-8222-222222222222",
          preferences: {necessary: true, analytics: true, advertising: false},
          gpcDetected: false,
          updatedAt: "2026-09-01T16:01:00.000Z",
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({consent: {
      consentId,
      preferences: {advertising: false},
    }});
  });

  test("does not let an older canonical grant re-enable a newer website revocation", async () => {
    const token = signWebsiteConsent({
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: false,
      updatedAt: "2026-09-01T16:01:00.000Z",
    }, signingSecret);

    const response = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`),
      {
        signingSecret,
        now: () => now,
        synchronize: async () => ({
          policyVersion: "piw-privacy-v1",
          consentId,
          preferences: {necessary: true, analytics: true, advertising: true},
          gpcDetected: false,
          updatedAt: "2026-09-01T16:00:00.000Z",
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({consent: {
      preferences: {advertising: false},
      updatedAt: "2026-09-01T16:01:00.000Z",
    }});
  });

  test("treats browser-reported GPC as a current denial before consulting canonical state", async () => {
    const token = signWebsiteConsent({
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-09-01T16:00:00.000Z",
    }, signingSecret);
    const synchronize = vi.fn(async (candidate: unknown) => candidate);

    const response = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`, {"x-all-season-gpc": "1"}),
      {signingSecret, now: () => now, synchronize} as never,
    );

    await expect(response.json()).resolves.toMatchObject({consent: {
      gpcDetected: true,
      preferences: {advertising: false},
      updatedAt: now.toISOString(),
    }});
    expect(synchronize).toHaveBeenCalledWith(expect.objectContaining({
      gpcDetected: true,
      preferences: expect.objectContaining({advertising: false}),
      updatedAt: now.toISOString(),
    }));
  });

  test("treats stale cookie GPC as historical when a later PIW grant exists and live GPC is off", async () => {
    const historicalGpc = {
      policyVersion: "piw-privacy-v1" as const,
      consentId,
      preferences: {necessary: true as const, analytics: true, advertising: false},
      gpcDetected: true,
      updatedAt: "2026-09-01T16:00:00.000Z",
    };
    const laterGrant = {
      ...historicalGpc,
      preferences: {...historicalGpc.preferences, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-09-01T16:01:00.000Z",
    };
    const token = signWebsiteConsent(historicalGpc, signingSecret);
    const synchronize = vi.fn(async () => laterGrant);

    const response = await handlePrivacyConsentStatusRequest(
      statusRequest(`piw_privacy=${token}`),
      {signingSecret, now: () => now, synchronize} as never,
    );

    await expect(response.json()).resolves.toEqual({consent: laterGrant});
    expect(synchronize).toHaveBeenCalledWith(expect.objectContaining({gpcDetected: false}));
  });

  test("sets a PIW-compatible HttpOnly consent cookie", async () => {
    const response = await handlePrivacyConsentRequest(
      request({analytics: true, advertising: true}),
      {signingSecret, nodeEnv: "production", now: () => now, createId: () => consentId},
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("piw_privacy=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
    const token = response.cookies.get("piw_privacy")?.value;
    expect(readWebsiteConsent(token, signingSecret)).toMatchObject({
      consentId,
      preferences: {necessary: true, analytics: true, advertising: true},
    });
  });

  test("honors Sec-GPC by forcing advertising denied", async () => {
    const response = await handlePrivacyConsentRequest(
      request({analytics: true, advertising: true}, {"sec-gpc": "1"}),
      {signingSecret, nodeEnv: "test", now: () => now, createId: () => consentId},
    );

    await expect(response.json()).resolves.toMatchObject({consent: {
      gpcDetected: true,
      preferences: {necessary: true, analytics: true, advertising: false},
    }});
  });

  test("rejects malformed choices and unavailable signing", async () => {
    const dependencies = {
      signingSecret,
      nodeEnv: "test" as const,
      now: () => now,
      createId: () => consentId,
    };
    expect((await handlePrivacyConsentRequest(request({analytics: "yes"}), dependencies)).status)
      .toBe(400);
    expect((await handlePrivacyConsentRequest(
      request({analytics: false, advertising: false}),
      {...dependencies, signingSecret: "short"},
    )).status).toBe(503);
  });

  test.each([null, "https://attacker.example"])(
    "rejects an unsafe browser Origin before synchronization (%s)",
    async (origin) => {
      const synchronize = vi.fn(async () => null);
      const headers = new Headers({"content-type": "application/json"});
      if (origin) headers.set("origin", origin);
      const unsafe = new NextRequest("https://allseason.example/api/privacy/consent", {
        method: "POST",
        headers,
        body: JSON.stringify({analytics: false, advertising: false}),
      });

      const response = await handlePrivacyConsentRequest(unsafe, {
        signingSecret, nodeEnv: "test", now: () => now, createId: () => consentId, synchronize,
      });

      expect(response.status).toBe(403);
      expect(synchronize).not.toHaveBeenCalled();
    },
  );

  test("keeps tracking denied when the durable canonical limiter rejects a grant", async () => {
    const response = await handlePrivacyConsentRequest(
      request({analytics: true, advertising: true}),
      {
        signingSecret,
        nodeEnv: "test",
        now: () => now,
        createId: () => consentId,
        synchronize: async () => null,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      consent: {preferences: {advertising: false}},
    });
  });
});
