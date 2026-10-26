import {describe, expect, test} from "vitest";
import {
  AD_ATTRIBUTION_MAX_TOKEN_LENGTH,
  attributionCookieDomain,
  classifyTouch,
  decodeAttributionToken,
  encodeAttributionToken,
  extractTouch,
  mergeTouch,
} from "./ad-attribution";

const SECRET = "a".repeat(32);
const NOW = new Date("2026-10-25T16:00:00.000Z");

function url(query: string, path = "/roof-replacement") {
  return new URL(`https://allseasonroofingquote.com${path}?${query}`);
}

describe("extractTouch", () => {
  test("captures click IDs, UTMs and ValueTrack values", () => {
    const touch = extractTouch(
      url("gclid=Cj0KCQ_test&utm_source=google&utm_medium=cpc&campaignid=123&adgroupid=456&keyword=roof%20replacement&matchtype=p&targetid=kwd-789&device=m&network=g&loc_physical_ms=1023191"),
      NOW,
      {gpc: false},
    );
    expect(touch).toMatchObject({
      at: NOW.toISOString(),
      path: "/roof-replacement",
      host: "allseasonroofingquote.com",
      gclid: "Cj0KCQ_test",
      utm_source: "google",
      utm_medium: "cpc",
      campaignid: "123",
      adgroupid: "456",
      keyword: "roof replacement",
      matchtype: "p",
      targetid: "kwd-789",
      device: "m",
      network: "g",
      loc_physical_ms: "1023191",
    });
  });

  test("returns null for plain navigation so it never overwrites a paid touch", () => {
    expect(extractTouch(url("ref=nav"), NOW, {gpc: false})).toBeNull();
  });

  test("drops click IDs under Global Privacy Control but keeps campaign tags", () => {
    const touch = extractTouch(url("gclid=abc&fbclid=def&utm_source=google&utm_medium=cpc"), NOW, {gpc: true});
    expect(touch?.gclid).toBeUndefined();
    expect(touch?.fbclid).toBeUndefined();
    expect(touch?.utm_source).toBe("google");
  });

  test("returns null under GPC when the only signal was a click ID", () => {
    expect(extractTouch(url("gclid=abc"), NOW, {gpc: true})).toBeNull();
  });

  test("ignores unsubstituted ValueTrack placeholders and control characters", () => {
    const touch = extractTouch(url("keyword=%7Bkeyword%7D&utm_source=goo%00gle"), NOW, {gpc: false});
    expect(touch?.keyword).toBeUndefined();
    expect(touch?.utm_source).toBe("google");
  });

  test("bounds oversized values", () => {
    const touch = extractTouch(url(`utm_campaign=${"x".repeat(500)}&gclid=${"g".repeat(900)}`), NOW, {gpc: false});
    expect(touch?.utm_campaign).toHaveLength(200);
    expect(touch?.gclid).toHaveLength(512);
  });
});

describe("mergeTouch", () => {
  test("keeps the first touch and replaces the last", () => {
    const first = extractTouch(url("utm_source=facebook&utm_medium=paid_social&fbclid=f1"), new Date("2026-10-01T00:00:00Z"), {gpc: false})!;
    const second = extractTouch(url("gclid=g2"), NOW, {gpc: false})!;
    const merged = mergeTouch(mergeTouch(null, first, first.at ? new Date(first.at) : NOW), second, NOW);
    expect(merged.first?.fbclid).toBe("f1");
    expect(merged.last.gclid).toBe("g2");
  });

  test("starts over when the first touch has aged out of the window", () => {
    const old = extractTouch(url("gclid=old"), new Date("2026-06-01T00:00:00Z"), {gpc: false})!;
    const fresh = extractTouch(url("gclid=new"), NOW, {gpc: false})!;
    const merged = mergeTouch({v: 1, last: old}, fresh, NOW);
    expect(merged.first).toBeUndefined();
    expect(merged.last.gclid).toBe("new");
  });
});

describe("token encoding", () => {
  test("round-trips a signed token", () => {
    const state = mergeTouch(null, extractTouch(url("gclid=abc&utm_source=google"), NOW, {gpc: false})!, NOW);
    const token = encodeAttributionToken(state, SECRET)!;
    expect(decodeAttributionToken(token, SECRET, NOW)).toEqual(state);
  });

  test("rejects a tampered payload or a different secret", () => {
    const state = mergeTouch(null, extractTouch(url("gclid=abc"), NOW, {gpc: false})!, NOW);
    const token = encodeAttributionToken(state, SECRET)!;
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({...state, last: {...state.last, gclid: "forged"}})).toString("base64url");
    expect(decodeAttributionToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(decodeAttributionToken(`${payload}.${signature}`, "b".repeat(32), NOW)).toBeNull();
    expect(decodeAttributionToken("not-a-token", SECRET, NOW)).toBeNull();
  });

  test("refuses short secrets", () => {
    const state = mergeTouch(null, extractTouch(url("gclid=abc"), NOW, {gpc: false})!, NOW);
    expect(encodeAttributionToken(state, "short")).toBeNull();
    expect(decodeAttributionToken("a.b", "short", NOW)).toBeNull();
  });

  test("expires tokens whose last touch is older than 90 days", () => {
    const old = new Date("2026-07-01T00:00:00Z");
    const state = mergeTouch(null, extractTouch(url("gclid=abc"), old, {gpc: false})!, old);
    const token = encodeAttributionToken(state, SECRET)!;
    expect(decodeAttributionToken(token, SECRET, NOW)).toBeNull();
  });

  test("drops the first touch when both do not fit in a cookie", () => {
    const big = (id: string, at: Date) => extractTouch(
      url(`gclid=${id.repeat(512)}&fbclid=${id.repeat(512)}&msclkid=${id.repeat(512)}&utm_campaign=${id.repeat(200)}&utm_content=${id.repeat(200)}`),
      at,
      {gpc: false},
    )!;
    const state = mergeTouch(mergeTouch(null, big("a", NOW), NOW), big("b", NOW), NOW);
    const token = encodeAttributionToken(state, SECRET)!;
    expect(token.length).toBeLessThanOrEqual(AD_ATTRIBUTION_MAX_TOKEN_LENGTH);
    const decoded = decodeAttributionToken(token, SECRET, NOW)!;
    expect(decoded.first).toBeUndefined();
    expect(decoded.last.gclid?.startsWith("b")).toBe(true);
  });
});

describe("classifyTouch", () => {
  test.each([
    ["gclid=x", "google_ads"],
    ["gbraid=x", "google_ads"],
    ["utm_source=google&utm_medium=cpc", "google_ads"],
    ["gad_source=1", "google_ads"],
    ["msclkid=x", "microsoft_ads"],
    ["fbclid=x", "meta_ads"],
    ["utm_source=facebook&utm_medium=paid_social", "meta_ads"],
    ["utm_source=newsletter&utm_medium=cpc", "other_paid"],
    ["utm_source=newsletter&utm_medium=email", "untracked"],
  ])("%s -> %s", (query, channel) => {
    expect(classifyTouch(extractTouch(url(query), NOW, {gpc: false}))).toBe(channel);
  });
});

describe("attributionCookieDomain", () => {
  test.each([
    ["allseasonroofingquote.com", "allseasonroofingquote.com"],
    ["www.allseasonroofingquote.com", "allseasonroofingquote.com"],
    ["estimate.allseasonroofingquote.com", "allseasonroofingquote.com"],
    ["allseasonsolar.net", "allseasonsolar.net"],
    ["rake-website-git-main.vercel.app", undefined],
    ["localhost", undefined],
    ["127.0.0.1", undefined],
  ])("%s -> %s", (host, domain) => {
    expect(attributionCookieDomain(host)).toBe(domain);
  });
});
