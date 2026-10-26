import { describe, expect, test, vi } from "vitest";
import { evaluatePaidSearchHealth, postSlackAlert, type PaidSearchHealth } from "./alerts";

const NOW = new Date("2026-10-25T14:00:00Z");
const healthy: PaidSearchHealth = {
  spend_48h_usd: 160,
  google_leads_48h: 2,
  clicks_yesterday: 40,
  google_arrivals_yesterday: 38,
  month_to_date_spend_usd: 2000,
  monthly_budget_usd: 2500,
  day_of_month: 25,
  days_in_month: 31,
  uploads_permanent_failed_24h: 0,
  uploads_retrying_over_6h: 0,
  retractions_failed: 0,
  last_spend_import_succeeded_at: "2026-10-25T10:20:00Z",
  spend_import_enabled: true,
};

const keys = (health: PaidSearchHealth) => evaluatePaidSearchHealth(health, NOW).map((alert) => alert.key);

describe("evaluatePaidSearchHealth", () => {
  test("is quiet when everything is normal", () => {
    expect(keys(healthy)).toEqual([]);
  });
  test.each([
    [{google_leads_48h: 0}, "spend_without_leads"],
    [{google_arrivals_yesterday: 20}, "click_arrival_gap"],
    [{month_to_date_spend_usd: 2600}, "budget_overpacing"],
    [{month_to_date_spend_usd: 1000}, "budget_underpacing"],
    [{uploads_permanent_failed_24h: 2}, "conversion_upload_failed"],
    [{uploads_retrying_over_6h: 1}, "conversion_upload_retrying"],
    [{retractions_failed: 1}, "conversion_retraction_failed"],
    [{last_spend_import_succeeded_at: "2026-10-23T10:00:00Z"}, "spend_import_stale"],
  ])("%o -> %s", (overrides, key) => {
    expect(keys({...healthy, ...overrides})).toContain(key);
  });
  test("ignores small click counts and early-month pacing", () => {
    expect(keys({...healthy, clicks_yesterday: 10, google_arrivals_yesterday: 0})).not.toContain("click_arrival_gap");
    expect(keys({...healthy, day_of_month: 2, month_to_date_spend_usd: 900})).toEqual([]);
  });
  test("messages avoid em dashes", () => {
    const all = evaluatePaidSearchHealth({...healthy, google_leads_48h: 0, google_arrivals_yesterday: 1, uploads_permanent_failed_24h: 1}, NOW);
    for (const alert of all) expect(alert.message).not.toContain("—");
  });
});

describe("postSlackAlert", () => {
  test("posts only to Slack webhooks", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", {status: 200}));
    expect(await postSlackAlert("https://example.com/hook", "x", fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(await postSlackAlert("https://hooks.slack.com/services/T/B/X", "x", fetchImpl as unknown as typeof fetch)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
