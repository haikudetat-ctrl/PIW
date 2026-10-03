import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handleAllSeasonPropertyPreviewRequest } from "./route";

const valid = {
  address: "1 Main St, Newark, NJ 07102, USA",
  google_place_id: "ChIJ-one",
  campaign: "weather-report",
  entry_point: "campaign:weather-report",
  presentation_key: "weather-report",
  attribution: {utm_source: "facebook", utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, fbclid: "abc"},
  referrer: "https://allseasonroofingquote.com/campaigns/weather-report",
  client_ip_address: "203.0.113.5",
  client_user_agent: "Mozilla/5.0",
  turnstile_token: "turnstile-token",
};

function request(body: unknown, secret = "shared-secret") {
  return new NextRequest("https://piw.example/api/integrations/all-season/property-preview", {
    method: "POST",
    headers: {"content-type": "application/json", "x-all-season-intake-secret": secret},
    body: JSON.stringify(body),
  });
}

const companyId = "11111111-1111-4111-8111-111111111111";

describe("All Season property preview intake", () => {
  test("creates a preview for the configured company and returns only its URL", async () => {
    const create = vi.fn(async () => ({kind: "created" as const, previewUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/token"}));
    const response = await handleAllSeasonPropertyPreviewRequest(request(valid), {expectedSecret: "shared-secret", companyId, create});
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({previewUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/token"});
    expect(create).toHaveBeenCalledWith({
      companyId,
      address: valid.address,
      googlePlaceId: "ChIJ-one",
      campaign: "weather-report",
      entryPoint: "campaign:weather-report",
      presentationKey: "weather-report",
      attribution: valid.attribution,
      referrer: valid.referrer,
      clientIp: "203.0.113.5",
      userAgent: "Mozilla/5.0",
      turnstileToken: "turnstile-token",
      privacyConsentToken: null,
    });
  });

  test("rejects the wrong shared secret before parsing", async () => {
    const create = vi.fn();
    const response = await handleAllSeasonPropertyPreviewRequest(request(valid, "wrong"), {expectedSecret: "shared-secret", companyId, create});
    expect(response.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ["coordinates", {...valid, latitude: 40.7}],
    ["a mismatched campaign", {...valid, campaign: "seasonal-shield"}],
    ["main-site context with a campaign", {...valid, entry_point: "main-home", presentation_key: "all-season-main"}],
    ["a missing challenge token", {...valid, turnstile_token: ""}],
  ])("rejects %s", async (_label, body) => {
    const create = vi.fn();
    const response = await handleAllSeasonPropertyPreviewRequest(request(body), {expectedSecret: "shared-secret", companyId, create});
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    [{kind: "challenge_failed" as const}, 403, "challenge_failed"],
    [{kind: "rate_limited" as const}, 429, "rate_limited"],
    [{kind: "disabled" as const}, 503, "unavailable"],
  ])("maps %o to %i", async (result, status, error) => {
    const response = await handleAllSeasonPropertyPreviewRequest(request(valid), {
      expectedSecret: "shared-secret", companyId, create: vi.fn(async () => result),
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({error});
  });

  test("returns a generic 503 without leaking a dependency error", async () => {
    const response = await handleAllSeasonPropertyPreviewRequest(request(valid), {
      expectedSecret: "shared-secret", companyId, create: vi.fn(async () => { throw new Error("db password wrong"); }),
    });
    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain("password");
  });
});
