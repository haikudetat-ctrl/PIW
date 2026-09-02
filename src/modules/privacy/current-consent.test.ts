import {describe, expect, test, vi} from "vitest";
import {signConsentCookie, type VerifiedConsent} from "./consent";
import {resolveCurrentVerifiedConsent} from "./current-consent";

const signingSecret = "0123456789abcdef0123456789abcdef";
const granted: VerifiedConsent = {
  policyVersion: "piw-privacy-v1",
  consentId: "11111111-1111-4111-8111-111111111111",
  preferences: {necessary: true, analytics: true, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};

function repository(current: VerifiedConsent | null) {
  return {
    record: vi.fn(async () => undefined),
    readCurrent: vi.fn(async () => current),
  };
}

describe("resolveCurrentVerifiedConsent", () => {
  test("uses canonical revocation instead of a stale signed website grant", async () => {
    const revoked: VerifiedConsent = {
      ...granted,
      preferences: {...granted.preferences, advertising: false},
      updatedAt: "2026-09-01T16:01:00.000Z",
    };
    const currentRepository = repository(revoked);

    await expect(resolveCurrentVerifiedConsent({
      consentToken: signConsentCookie(granted, signingSecret),
      signingSecret,
      gpcDetected: false,
      now: () => new Date("2026-09-01T16:02:00.000Z"),
      repository: currentRepository,
    })).resolves.toEqual(revoked);
    expect(currentRepository.readCurrent).toHaveBeenCalledWith({
      consentId: granted.consentId,
      policyVersion: "piw-privacy-v1",
    });
  });

  test("makes GPC authoritative even when the signed and canonical states are grants", async () => {
    await expect(resolveCurrentVerifiedConsent({
      consentToken: signConsentCookie(granted, signingSecret),
      signingSecret,
      gpcDetected: true,
      now: () => new Date("2026-09-01T16:02:00.000Z"),
      repository: repository(granted),
    })).resolves.toEqual({
      ...granted,
      preferences: {...granted.preferences, advertising: false},
      gpcDetected: true,
      updatedAt: "2026-09-01T16:02:00.000Z",
    });
  });

  test("fails closed when the current canonical consent is unavailable or divergent", async () => {
    const divergent: VerifiedConsent = {
      ...granted,
      consentId: "22222222-2222-4222-8222-222222222222",
    };
    const token = signConsentCookie(granted, signingSecret);

    await expect(resolveCurrentVerifiedConsent({
      consentToken: token,
      signingSecret,
      gpcDetected: false,
      now: () => new Date("2026-09-01T16:02:00.000Z"),
      repository: repository(null),
    })).resolves.toBeNull();
    await expect(resolveCurrentVerifiedConsent({
      consentToken: token,
      signingSecret,
      gpcDetected: false,
      now: () => new Date("2026-09-01T16:02:00.000Z"),
      repository: repository(divergent),
    })).resolves.toBeNull();
  });
});
