import { describe, expect, test } from "vitest";
import { encodeAttributionToken, extractTouch, mergeTouch } from "@/../shared/ad-attribution";
import { buildLeadAdAttribution } from "./attribution";

const SECRET = "k".repeat(32);
const NOW = new Date("2026-10-25T16:00:00Z");
const legacy = {utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, fbclid: null, fbp: null, fbc: null};

function token(query: string, at = NOW, previous?: string) {
  const touch = extractTouch(new URL(`https://allseasonroofingquote.com/roof-replacement?${query}`), at, {gpc: false})!;
  const base = previous ? JSON.parse(Buffer.from(previous.split(".")[0], "base64url").toString()) : null;
  return encodeAttributionToken(mergeTouch(base, touch, at), SECRET)!;
}

function build(overrides: Partial<Parameters<typeof buildLeadAdAttribution>[0]>) {
  return buildLeadAdAttribution({
    companyId: "c0000000-0000-4000-8000-000000000001",
    leadId: "l0000000-0000-4000-8000-000000000001",
    token: null,
    secret: SECRET,
    legacy,
    submittedAt: NOW.toISOString(),
    now: NOW,
    ...overrides,
  });
}

describe("buildLeadAdAttribution", () => {
  test("credits Google and keeps the click ID and ValueTrack values from a verified token", () => {
    const row = build({token: token("gclid=G1&campaignid=11&adgroupid=22&keyword=roof%20cost&matchtype=e&targetid=kwd-33")});
    expect(row).toMatchObject({
      channel: "google_ads",
      click_id_type: "gclid",
      gclid: "G1",
      google_campaign_id: "11",
      google_ad_group_id: "22",
      google_keyword: "roof cost",
      google_match_type: "e",
      google_target_id: "kwd-33",
      landing_path: "/roof-replacement",
      token_verified: true,
    });
  });

  test("prefers gclid, then gbraid, then wbraid", () => {
    expect(build({token: token("gbraid=B1&wbraid=W1")}).click_id_type).toBe("gbraid");
    expect(build({token: token("wbraid=W1")}).click_id_type).toBe("wbraid");
  });

  test("never trusts a click ID without a verified token", () => {
    const forged = build({token: "bogus.token", legacy: {...legacy, utm_source: "google", utm_medium: "cpc"}});
    expect(forged.token_verified).toBe(false);
    expect(forged.gclid).toBeNull();
    expect(forged.click_id_type).toBeNull();
    expect(forged.channel).toBe("google_ads");
  });

  test("falls back to the legacy fields for Meta credit", () => {
    const row = build({legacy: {...legacy, fbclid: "F1", utm_source: "facebook", utm_medium: "paid_social"}});
    expect(row.channel).toBe("meta_ads");
    expect(row.fbclid).toBe("F1");
  });

  test("credits the earlier paid touch when the latest touch was not paid", () => {
    const paid = token("gclid=G1", new Date("2026-10-20T00:00:00Z"));
    const later = token("utm_source=newsletter&utm_medium=email", NOW, paid);
    const row = build({token: later});
    expect(row.channel).toBe("google_ads");
    expect(row.gclid).toBe("G1");
    expect(row.first_touch?.gclid).toBe("G1");
  });

  test("records untracked leads too", () => {
    expect(build({}).channel).toBe("untracked");
  });
});
