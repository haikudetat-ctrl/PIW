import {afterEach, describe, expect, test, vi} from "vitest";
import {synchronizeCanonicalWebsiteConsent} from "./canonical-privacy-consent";
import {readWebsiteConsent} from "./privacy-consent";

afterEach(() => vi.unstubAllGlobals());

describe("canonical website consent synchronization", () => {
  test("does not synthesize Sec-GPC from historical cookie evidence", async () => {
    const consent = {
      policyVersion: "piw-privacy-v1" as const,
      consentId: "11111111-1111-4111-8111-111111111111",
      preferences: {necessary: true as const, analytics: true, advertising: false},
      gpcDetected: true,
      updatedAt: "2026-09-01T16:00:00.000Z",
    };
    const laterGrant = {
      ...consent,
      preferences: {...consent.preferences, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-09-01T16:01:00.000Z",
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({consent: laterGrant});
    });
    vi.stubGlobal("fetch", fetch);

    await synchronizeCanonicalWebsiteConsent({
      consent,
      liveGpcDetected: false,
      signingSecret: "0123456789abcdef0123456789abcdef",
      sharedSecret: "shared-secret",
      publicPiwUrl: "https://piw.example",
      websiteOrigin: "https://allseasonsolar.net",
      nodeEnv: "production",
      requestIp: "203.0.113.7",
    });

    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({
        "x-all-season-privacy-request-ip": "203.0.113.7",
      }),
    }));
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.not.objectContaining({"sec-gpc": "1"}),
    }));
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(readWebsiteConsent(
      headers["x-piw-privacy-consent"],
      "0123456789abcdef0123456789abcdef",
    )).toMatchObject({gpcDetected: false});
  });
});
