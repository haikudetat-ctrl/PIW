import {afterEach, describe, expect, test, vi} from "vitest";
import {buildArrival, isLikelyBot, shouldLogArrival, visitorHash} from "./arrival-beacon";

const SECRET = "test-salt";
const NOW = new Date("2026-09-14T15:04:05.000Z");

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("isLikelyBot", () => {
  test("flags known crawlers and treats a missing agent as suspect", () => {
    expect(isLikelyBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLikelyBot("curl/8.4.0")).toBe(true);
    expect(isLikelyBot(null)).toBe(true);
  });

  test.each([
    "/wp-admin/install.php",
    "/wp-login.php",
    "/xmlrpc.php",
    "/.env",
    "/.git/config",
    "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
    "/cgi-bin/luci",
    "/index.php",
  ])("flags vulnerability-scanner path %s even with a browser agent", (pathname) => {
    expect(isLikelyBot(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
      pathname,
    )).toBe(true);
  });

  test("does not flag ordinary site pages", () => {
    const agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
    for (const pathname of ["/", "/index.html", "/contact.html", "/campaigns/for-every-season", "/services/roofing.html"]) {
      expect(isLikelyBot(agent, pathname)).toBe(false);
    }
  });

  test("does not flag an ordinary mobile browser", () => {
    expect(isLikelyBot(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    )).toBe(false);
  });
});

describe("visitorHash", () => {
  test("is stable within a day and changes the next day", async () => {
    const monday = await visitorHash(SECRET, NOW, "203.0.113.7", "agent");
    const sameDay = await visitorHash(SECRET, new Date("2026-09-14T23:59:00.000Z"), "203.0.113.7", "agent");
    const nextDay = await visitorHash(SECRET, new Date("2026-09-15T00:01:00.000Z"), "203.0.113.7", "agent");

    expect(monday).toMatch(/^[0-9a-f]{64}$/);
    expect(sameDay).toBe(monday);
    expect(nextDay).not.toBe(monday);
  });

  test("separates distinct visitors", async () => {
    const a = await visitorHash(SECRET, NOW, "203.0.113.7", "agent");
    const b = await visitorHash(SECRET, NOW, "203.0.113.8", "agent");
    expect(a).not.toBe(b);
  });
});

describe("buildArrival", () => {
  test("captures campaign, paid click id and Meta dynamic parameters", async () => {
    const url = new URL(
      "https://allseasonroofingquote.com/campaigns/for-every-season"
      + "?fbclid=IwAR123&utm_source=meta&utm_medium=paid_social"
      + "&utm_campaign=C2&utm_content=C2%20%7C%20Static%20%7C%20FES"
      + "&placement=facebook_reels&site_source_name=fb",
    );

    const arrival = await buildArrival({
      url,
      headers: headers({"user-agent": "Mozilla/5.0 (iPhone)", referer: "https://l.facebook.com/"}),
      ip: "203.0.113.7",
      secret: SECRET,
      now: NOW,
    });

    expect(arrival.request_path).toBe("/campaigns/for-every-season");
    expect(arrival.campaign_slug).toBe("for-every-season");
    expect(arrival.fbclid).toBe("IwAR123");
    expect(arrival.utm_content).toBe("C2 | Static | FES");
    expect(arrival.meta_placement).toBe("facebook_reels");
    expect(arrival.meta_site_source).toBe("fb");
    expect(arrival.referrer_host).toBe("l.facebook.com");
    expect(arrival.is_likely_bot).toBe(false);
    expect(arrival.occurred_at).toBe("2026-09-14T15:04:05.000Z");
  });

  test("records no raw address and nulls an unknown campaign", async () => {
    const arrival = await buildArrival({
      url: new URL("https://allseasonroofingquote.com/campaigns/not-a-campaign"),
      headers: headers({"user-agent": "Mozilla/5.0 (iPhone)"}),
      ip: "203.0.113.7",
      secret: SECRET,
      now: NOW,
    });

    expect(arrival.campaign_slug).toBeNull();
    expect(arrival.referrer_host).toBeNull();
    expect(JSON.stringify(arrival)).not.toContain("203.0.113.7");
  });

  test("falls back to utm_term when placement is not passed separately", async () => {
    const arrival = await buildArrival({
      url: new URL("https://allseasonroofingquote.com/?utm_term=instagram_stories"),
      headers: headers({"user-agent": "Mozilla/5.0 (iPhone)"}),
      ip: null,
      secret: SECRET,
      now: NOW,
    });

    expect(arrival.meta_placement).toBe("instagram_stories");
  });
});

describe("shouldLogArrival", () => {
  test("logs real page requests, including the static public pages", () => {
    for (const path of ["/", "/campaigns/for-every-season", "/campaigns/weather-report",
                        "/service-areas/atlantic-county.html", "/privacy"]) {
      expect(shouldLogArrival(path)).toBe(true);
    }
  });

  test("skips build output, api routes and static assets", () => {
    for (const path of ["/_next/static/chunks/main.js", "/_next/image", "/api/campaign-estimate",
                        "/favicon.ico", "/robots.txt", "/sitemap.xml",
                        "/campaigns/weather-report/hero.webp", "/styles.css",
                        "/privacy-runtime.js", "/fonts/inter.woff2"]) {
      expect(shouldLogArrival(path)).toBe(false);
    }
  });
});

describe("experiment arm", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function arrival() {
    return buildArrival({
      url: new URL("https://allseasonroofingquote.com/campaigns/weather-report"),
      headers: new Headers({"user-agent": "Mozilla/5.0"}),
      ip: "203.0.113.5",
      secret: "test-salt",
      now: new Date("2026-10-03T12:00:00.000Z"),
    });
  }

  test("omits the arm while the value-first flow is off", async () => {
    expect(await arrival()).not.toHaveProperty("experiment_arm");
  });

  test("tags value-first arrivals once the flow is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    expect((await arrival()).experiment_arm).toBe("value_first");
  });
});
