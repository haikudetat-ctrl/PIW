import {NextRequest} from "next/server";
import {describe, expect, test} from "vitest";
import {readWebsiteConsent} from "../../../../lib/privacy-consent";
import {handlePrivacyConsentRequest} from "./route";

const signingSecret = "0123456789abcdef0123456789abcdef";
const consentId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-01T16:00:00.000Z");

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://allseason.example/api/privacy/consent", {
    method: "POST",
    headers: {"content-type": "application/json", ...headers},
    body: JSON.stringify(body),
  });
}

describe("website privacy consent endpoint", () => {
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
});
