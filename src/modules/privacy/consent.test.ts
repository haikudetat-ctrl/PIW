import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  CONSENT_POLICY_VERSION,
  normalizeConsentPreferences,
  signConsentCookie,
  verifyConsentCookie,
} from "./consent";

const secret = "0123456789abcdef0123456789abcdef";
const consentId = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-08-28T12:00:00.000Z";

function signedCookie(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded, "ascii").digest("base64url");
  return `${encoded}.${signature}`;
}

describe("normalizeConsentPreferences", () => {
  test("defaults nonessential consent to denied", () => {
    expect(normalizeConsentPreferences({})).toEqual({
      necessary: true,
      analytics: false,
      advertising: false,
    });
  });

  test("GPC forces advertising off", () => {
    expect(normalizeConsentPreferences({ analytics: true, advertising: true }, true))
      .toEqual({ necessary: true, analytics: true, advertising: false });
  });
});

describe("signed consent cookies", () => {
  test("round trips a signed consent cookie", () => {
    const value = signConsentCookie({
      consentId,
      preferences: { necessary: true, analytics: true, advertising: false },
      gpcDetected: false,
      updatedAt,
    }, secret);

    expect(verifyConsentCookie(value, secret)).toEqual({
      policyVersion: CONSENT_POLICY_VERSION,
      consentId,
      preferences: { necessary: true, analytics: true, advertising: false },
      gpcDetected: false,
      updatedAt,
    });
  });

  test("rejects a tampered cookie", () => {
    const value = signConsentCookie({
      consentId,
      preferences: { necessary: true, analytics: false, advertising: false },
      gpcDetected: false,
      updatedAt,
    }, secret);

    expect(verifyConsentCookie(`${value}x`, secret)).toBeNull();
  });

  test("fails closed for advertising when GPC is detected", () => {
    const value = signConsentCookie({
      consentId,
      preferences: { necessary: true, analytics: true, advertising: true },
      gpcDetected: true,
      updatedAt,
    }, secret);

    expect(verifyConsentCookie(value, secret)?.preferences.advertising).toBe(false);
  });

  test.each([
    ["wrong policy version", { v: "piw-privacy-v0", cid: consentId, a: false, d: false, g: false, at: updatedAt }],
    ["invalid UUID", { v: CONSENT_POLICY_VERSION, cid: "not-a-uuid", a: false, d: false, g: false, at: updatedAt }],
    ["invalid timestamp", { v: CONSENT_POLICY_VERSION, cid: consentId, a: false, d: false, g: false, at: "not-a-timestamp" }],
    ["unknown payload field", { v: CONSENT_POLICY_VERSION, cid: consentId, a: false, d: false, g: false, at: updatedAt, extra: true }],
    ["GPC advertising bypass", { v: CONSENT_POLICY_VERSION, cid: consentId, a: false, d: true, g: true, at: updatedAt }],
  ])("rejects a signed cookie with %s", (_reason, payload) => {
    expect(verifyConsentCookie(signedCookie(payload), secret)).toBeNull();
  });

  test("rejects malformed cookie values", () => {
    expect(verifyConsentCookie("not-a-cookie", secret)).toBeNull();
    expect(verifyConsentCookie("payload.invalid-signature", secret)).toBeNull();
  });
});
