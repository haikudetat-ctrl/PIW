import {NextRequest} from "next/server";
import {beforeEach, describe, expect, test, vi} from "vitest";
import {signConsentCookie, type VerifiedConsent} from "@/modules/privacy/consent";

const mocks = vi.hoisted(() => ({
  readCurrent: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  parseServerEnv: () => ({
    DEPLOYMENT_ENV: "production",
    VERCEL_ENV: "preview",
    PRIVACY_CONSENT_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
    ALL_SEASON_INTAKE_SHARED_SECRET: "all-season-server-secret",
  }),
}));

vi.mock("@/modules/privacy/consent-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/privacy/consent-repository")>();
  return {
    ...actual,
    SupabasePrivacyConsentRepository: class {
      readCurrent = mocks.readCurrent;
      record = mocks.record;
    },
  };
});

import {POST} from "./route";

const consent: VerifiedConsent = {
  policyVersion: "piw-privacy-v1",
  consentId: "11111111-1111-4111-8111-111111111111",
  preferences: {necessary: true, analytics: true, advertising: true},
  gpcDetected: false,
  updatedAt: new Date().toISOString(),
};

describe("current privacy consent runtime boundary", () => {
  beforeEach(() => {
    mocks.record.mockReset().mockResolvedValue(undefined);
    mocks.readCurrent.mockReset().mockResolvedValue(consent);
  });

  test("allows the Vercel Preview website origin when provider parity uses production deployment settings", async () => {
    const token = signConsentCookie(
      consent,
      "0123456789abcdef0123456789abcdef",
    );
    const request = new NextRequest(
      "https://piw-preview.vercel.app/api/privacy/consent/current",
      {
        method: "POST",
        headers: {
          origin: "https://rake-preview.vercel.app",
          "x-all-season-intake-secret": "all-season-server-secret",
          "x-all-season-privacy-request-ip": "203.0.113.7",
          "x-piw-privacy-consent": token,
        },
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({consent});
  });
});
