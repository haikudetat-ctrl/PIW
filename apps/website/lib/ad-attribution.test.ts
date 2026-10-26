import {NextRequest} from "next/server";
import {describe, expect, test} from "vitest";
import {
  AD_ATTRIBUTION_COOKIE_NAME,
  adAttributionForwardingEnabled,
  forwardableAttributionToken,
  nextAttributionCookie,
} from "./ad-attribution";

const SECRET = "s".repeat(32);
const NOW = new Date("2026-10-25T16:00:00.000Z");

function cookieFor(url: string, headers: Record<string, string> = {}, existing?: string) {
  return nextAttributionCookie({
    url: new URL(url),
    headers: new Headers(headers),
    existing,
    secret: SECRET,
    now: NOW,
  });
}

describe("nextAttributionCookie", () => {
  test("mints a cookie scoped to the registrable domain", () => {
    const cookie = cookieFor("https://www.allseasonroofingquote.com/roof-replacement?gclid=abc");
    expect(cookie?.domain).toBe("allseasonroofingquote.com");
    expect(cookie?.value).toContain(".");
  });

  test("keeps preview hosts host-only", () => {
    expect(cookieFor("https://rake-website-abc.vercel.app/roof-replacement?gclid=abc")?.domain).toBeUndefined();
  });

  test("withholds click IDs under Global Privacy Control", () => {
    expect(cookieFor("https://allseasonroofingquote.com/?gclid=abc", {"sec-gpc": "1"})).toBeNull();
    expect(cookieFor("https://allseasonroofingquote.com/?gclid=abc&utm_source=google", {"sec-gpc": "1"})).not.toBeNull();
  });

  test("returns null without a usable secret", () => {
    expect(nextAttributionCookie({
      url: new URL("https://allseasonroofingquote.com/?gclid=abc"),
      headers: new Headers(),
      existing: undefined,
      secret: null,
      now: NOW,
    })).toBeNull();
  });
});

describe("forwardableAttributionToken", () => {
  test("forwards only a verified token, and only when forwarding is on", () => {
    const token = cookieFor("https://allseasonroofingquote.com/?gclid=abc")!.value;
    const request = new NextRequest("https://allseasonroofingquote.com/api/property-preview", {
      headers: {cookie: `${AD_ATTRIBUTION_COOKIE_NAME}=${token}`},
    });
    expect(forwardableAttributionToken(request, {AD_ATTRIBUTION_SIGNING_SECRET: SECRET}, NOW)).toBeNull();
    expect(forwardableAttributionToken(request, {
      AD_ATTRIBUTION_SIGNING_SECRET: SECRET,
      AD_ATTRIBUTION_FORWARDING_ENABLED: "true",
    }, NOW)).toBe(token);

    const forged = new NextRequest("https://allseasonroofingquote.com/api/property-preview", {
      headers: {cookie: `${AD_ATTRIBUTION_COOKIE_NAME}=${token.slice(0, -2)}xx`},
    });
    expect(forwardableAttributionToken(forged, {
      AD_ATTRIBUTION_SIGNING_SECRET: SECRET,
      AD_ATTRIBUTION_FORWARDING_ENABLED: "true",
    }, NOW)).toBeNull();
  });

  test("the rollout flag is strictly opt-in", () => {
    expect(adAttributionForwardingEnabled({})).toBe(false);
    expect(adAttributionForwardingEnabled({AD_ATTRIBUTION_FORWARDING_ENABLED: "1"})).toBe(false);
    expect(adAttributionForwardingEnabled({AD_ATTRIBUTION_FORWARDING_ENABLED: "true"})).toBe(true);
  });
});
