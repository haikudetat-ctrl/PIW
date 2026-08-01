import { describe, expect, it } from "vitest";
import { buildCostDigestSlackPayload } from "./slack";

describe("cost Slack digest", () => {
  it("shows budget, forecast, providers, and API limits", () => {
    const payload = buildCostDigestSlackPayload({
      periodStart: "2026-08-01",
      budgetMicros: 1_500_000_000,
      currentMicros: 300_000_000,
      forecastMicros: 900_000_000,
      budgetUsedPercent: 20,
      forecastPercent: 60,
      remainingMicros: 1_200_000_000,
      safeDailyMicros: 40_000_000,
      providers: [{ provider: "vercel", currentMicros: 100_000_000, forecastMicros: 250_000_000, confidence: "provider meter" }],
      apiUsage: [{ name: "Google Solar", used: 500, limit: 1000, percent: 50 }],
      warnings: [],
      statuses: { vercel: "completed" },
    }, new Date("2026-08-15T13:00:00Z"));
    expect(payload.text).toContain("$300.00 of $1,500.00");
    expect(JSON.stringify(payload.blocks)).toContain("Google Solar");
    expect(JSON.stringify(payload.blocks)).toContain("50.0%");
  });
});
