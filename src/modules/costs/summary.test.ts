import { describe, expect, it } from "vitest";
import { buildCostSummary } from "./summary";
import type { CollectorResult } from "./contracts";

describe("cost digest summary", () => {
  it("uses actual charges ahead of estimates and excludes application telemetry from spend", () => {
    const results: CollectorResult[] = [
      { provider: "digitalocean", status: "completed", warnings: [], collectedAt: "2026-08-16T00:00:00Z", items: [{ provider: "digitalocean", sourceKey: "invoice", service: "invoice", environment: "shared", allocationBucket: "shared_platform", costKind: "actual", confidence: "invoice", amountMicros: 24_000_000, sourceTimestamp: "2026-08-16T00:00:00Z" }] },
      { provider: "supabase", status: "completed", warnings: [], collectedAt: "2026-08-16T00:00:00Z", items: [{ provider: "supabase", sourceKey: "plan", service: "plan", environment: "shared", allocationBucket: "shared_platform", costKind: "committed", confidence: "manual", amountMicros: 25_000_000, sourceTimestamp: "2026-08-16T00:00:00Z" }] },
      { provider: "application", status: "completed", warnings: [], collectedAt: "2026-08-16T00:00:00Z", items: [{ provider: "application", sourceKey: "quota", service: "Google Solar", environment: "production", allocationBucket: "api_calls", costKind: "estimated", confidence: "provider_meter", amountMicros: 99_000_000, usageQuantity: 500, usageUnit: "calls", freeLimit: 1000, sourceTimestamp: "2026-08-16T00:00:00Z" }] },
    ];
    const summary = buildCostSummary({ start: "2026-08-01", endExclusive: "2026-09-01", daysInMonth: 31, elapsedDays: 15, timezone: "America/New_York" }, 1_500_000_000, results);
    expect(summary.currentMicros).toBe(49_000_000);
    expect(summary.forecastMicros).toBe(74_600_000);
    expect(summary.apiUsage[0]).toMatchObject({ used: 500, limit: 1000, percent: 50 });
  });
});
