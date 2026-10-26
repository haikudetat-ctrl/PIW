import { describe, expect, test, vi } from "vitest";
import { campaignQuery, importGoogleAdsSpend, keywordQuery, spendWindow, toSpendRows } from "./spend-import";

describe("spend import", () => {
  test("uses a trailing seven day window in Eastern time", () => {
    expect(spendWindow(new Date("2026-10-25T03:00:00Z"))).toEqual({from: "2026-10-18", to: "2026-10-24"});
  });

  test("queries campaign and keyword grains", () => {
    expect(campaignQuery("2026-10-18", "2026-10-24")).toContain("FROM campaign WHERE segments.date BETWEEN '2026-10-18' AND '2026-10-24'");
    expect(keywordQuery("2026-10-18", "2026-10-24")).toContain("FROM keyword_view");
  });

  test("maps searchStream rows and drops malformed ones", () => {
    const rows = toSpendRows({
      companyId: "c",
      currencyCode: "USD",
      importedAt: "2026-10-25T10:00:00Z",
      campaignRows: [
        {campaign: {id: "42", name: "Roofing"}, segments: {date: "2026-10-24"}, metrics: {costMicros: "85000000", clicks: "7", impressions: "210", conversions: 1.5}},
        {campaign: {id: "bad"}, segments: {date: "2026-10-24"}},
      ],
      keywordRows: [
        {campaign: {id: "42"}, adGroup: {id: "555", name: "Roof Replacement"}, adGroupCriterion: {criterionId: "777", keyword: {text: "roof replacement", matchType: "PHRASE"}}, segments: {date: "2026-10-24"}, metrics: {costMicros: "60000000", clicks: "5"}},
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({grain: "campaign", campaign_id: "42", cost_micros: 85_000_000, clicks: 7, platform_conversions: 1.5, ad_group_id: "", criterion_id: ""});
    expect(rows[1]).toMatchObject({grain: "keyword", ad_group_id: "555", criterion_id: "777", keyword_text: "roof replacement", match_type: "PHRASE"});
  });

  test("records a failed run when Google errors", async () => {
    const store = {startRun: vi.fn(async () => "run-1"), finishRun: vi.fn(async () => undefined), upsertSpend: vi.fn()};
    const client = {search: vi.fn(async () => ({ok: false as const, errorCategory: "http_403"}))};
    const result = await importGoogleAdsSpend({companyId: "c", customerId: "1234567890", loginCustomerId: null, currencyCode: "USD", client, store, now: new Date()});
    expect(result).toEqual({ok: false, errorCategory: "http_403"});
    expect(store.upsertSpend).not.toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledWith("run-1", {status: "failed", rowsUpserted: null, errorCategory: "http_403"});
  });
});
