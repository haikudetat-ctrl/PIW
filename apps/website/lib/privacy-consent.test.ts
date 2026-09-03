import {describe, expect, test} from "vitest";
import {
  createConsentHandoff,
  PRIVACY_COOKIE_NAME,
  readWebsiteConsent,
  signWebsiteConsent,
} from "./privacy-consent";

const signingSecret = "0123456789abcdef0123456789abcdef";
const consent = {
  policyVersion: "piw-privacy-v1" as const,
  consentId: "11111111-1111-4111-8111-111111111111",
  preferences: {necessary: true as const, analytics: true, advertising: false},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};

describe("website privacy consent", () => {
  test("uses the PIW-compatible signed HttpOnly cookie contract", () => {
    const token = signWebsiteConsent(consent, signingSecret);

    expect(readWebsiteConsent(token, signingSecret)).toEqual(consent);
    expect(PRIVACY_COOKIE_NAME).toBe("piw_privacy");
    expect(readWebsiteConsent(`${token}x`, signingSecret)).toBeNull();
  });

  test("creates a handoff without exposing preference query parameters", async () => {
    const handoff = await createConsentHandoff({
      consentId: consent.consentId,
      policyVersion: consent.policyVersion,
      analytics: consent.preferences.analytics,
      advertising: consent.preferences.advertising,
      gpc: consent.gpcDetected,
      issuedAt: consent.updatedAt,
    }, "signed-continuation", signingSecret);

    expect(handoff).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(handoff).not.toContain("advertising");
  });
});
