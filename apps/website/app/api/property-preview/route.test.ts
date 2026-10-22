import {NextRequest} from "next/server";
import {describe, expect, test, vi} from "vitest";
import {signWebsiteConsent} from "../../../lib/privacy-consent";
import {handlePropertyPreviewRequest} from "./route";

const secret = "p".repeat(32);
const previewUrl = `https://estimate.allseasonroofingquote.com/roof-estimate/p/${"t".repeat(43)}`;
const consent = {
  consentId: "22222222-2222-4222-8222-222222222222",
  policyVersion: "piw-privacy-v1" as const,
  preferences: {necessary: true as const, analytics: true, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function request(body: unknown, cookie = "") {
  return new NextRequest("https://allseasonroofingquote.com/api/property-preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
      "user-agent": "Mozilla/5.0",
      referer: "https://allseasonroofingquote.com/campaigns/weather-report?utm_source=facebook",
      ...(cookie ? {cookie} : {}),
    },
    body: JSON.stringify(body),
  });
}

const valid = {
  address: "1 Main St, Newark, NJ 07102, USA",
  google_place_id: "ChIJ-one",
  campaign: "weather-report",
  entry_point: "campaign:weather-report",
  presentation_key: "weather-report",
  turnstile_token: "turnstile-token",
  utm_source: "facebook",
  fbclid: "abc",
};

describe("website POST /api/property-preview", () => {
  test("forwards the address step with browser evidence and returns the preview URL", async () => {
    const forward = vi.fn(async () => Response.json({previewUrl}, {status: 201}));
    const response = await handlePropertyPreviewRequest(request(valid), forward, secret);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({previewUrl});
    expect(forward).toHaveBeenCalledWith({
      address: valid.address,
      google_place_id: "ChIJ-one",
      campaign: "weather-report",
      entry_point: "campaign:weather-report",
      presentation_key: "weather-report",
      attribution: {utm_source: "facebook", utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, fbclid: "abc"},
      referrer: "https://allseasonroofingquote.com/campaigns/weather-report?utm_source=facebook",
      client_ip_address: "203.0.113.5",
      client_user_agent: "Mozilla/5.0",
      turnstile_token: "turnstile-token",
    }, {consentToken: undefined});
  });

  test("forwards a valid website consent token for later conversion", async () => {
    const token = signWebsiteConsent(consent, secret);
    const forward = vi.fn(async () => Response.json({previewUrl}, {status: 201}));
    await handlePropertyPreviewRequest(request(valid, `piw_privacy=${token}`), forward, secret);
    expect(forward).toHaveBeenCalledWith(expect.anything(), {consentToken: token});
  });

  test("drops an invalid consent cookie", async () => {
    const forward = vi.fn(async () => Response.json({previewUrl}, {status: 201}));
    await handlePropertyPreviewRequest(request(valid, "piw_privacy=forged"), forward, secret);
    expect(forward).toHaveBeenCalledWith(expect.anything(), {consentToken: undefined});
  });

  test.each([
    ["coordinates", {...valid, latitude: 40}],
    ["a mismatched campaign", {...valid, campaign: "seasonal-shield"}],
    ["no challenge token", {...valid, turnstile_token: ""}],
  ])("rejects %s without forwarding", async (_label, body) => {
    const forward = vi.fn();
    expect((await handlePropertyPreviewRequest(request(body), forward, secret)).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test.each([[403, 403], [429, 429], [503, 503], [500, 502]])("maps upstream %i to %i", async (upstream, expected) => {
    const response = await handlePropertyPreviewRequest(request(valid), vi.fn(async () => Response.json({error: "x"}, {status: upstream})), secret);
    expect(response.status).toBe(expected);
  });

  test("rejects a preview URL that isn't an https preview path", async () => {
    const response = await handlePropertyPreviewRequest(request(valid), vi.fn(async () => Response.json({previewUrl: "javascript:alert(1)"}, {status: 201})), secret);
    expect(response.status).toBe(502);
  });

  test("forwards a chat start and returns the chat URL", async () => {
    const chatUrl = `https://estimate.allseasonroofingquote.com/roof-estimate/chat/${"t".repeat(43)}`;
    const forward = vi.fn(async (_payload: unknown) => Response.json({previewUrl: chatUrl}, {status: 201}));
    const response = await handlePropertyPreviewRequest(request({
      ...valid,
      campaign: null,
      entry_point: "main-chat",
      presentation_key: "all-season-main",
    }), forward, secret);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({previewUrl: chatUrl});
    expect(forward.mock.calls[0][0]).toMatchObject({entry_point: "main-chat", campaign: null});
  });

  test("rejects other paths on the estimate host", async () => {
    const response = await handlePropertyPreviewRequest(request(valid), vi.fn(async () => Response.json({
      previewUrl: `https://estimate.allseasonroofingquote.com/roof-estimate/other/${"t".repeat(43)}`,
    }, {status: 201})), secret);
    expect(response.status).toBe(502);
  });
});
