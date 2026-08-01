import { describe, expect, it, vi } from "vitest";
import { collectVercelCosts } from "./vercel";
import { calendarMonthPeriod } from "../period";

describe("Vercel cost collector", () => {
  it("parses official billing charge JSON lines and attributes projects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      JSON.stringify({ ServiceName: "Functions", PricingQuantity: 12, PricingUnit: "USD", EffectiveCost: 1.5, BilledCost: 1.25, ChargePeriodStart: "2026-08-01T00:00:00Z", Tags: { ProjectId: "prj_prod", ProjectName: "piw" } }),
      JSON.stringify({ ServiceName: "Bandwidth", BilledCost: 0.25, ChargePeriodStart: "2026-08-01T00:00:00Z", Tags: { ProjectId: "prj_web" } }),
    ].join("\n")));
    const result = await collectVercelCosts(calendarMonthPeriod(new Date("2026-08-15T13:00:00Z")), {
      token: "token",
      teamId: "team",
      resourceMap: {
        "vercel:prj_prod": { environment: "production", allocationBucket: "piw" },
        "vercel:prj_web": { environment: "shared", allocationBucket: "shared_platform" },
      },
    }, fetcher);
    expect(result.status).toBe("completed");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ amountMicros: 1_250_000, environment: "production", allocationBucket: "piw" });
    expect(result.items[1]).toMatchObject({ environment: "shared", allocationBucket: "shared_platform" });
  });

  it("reports missing credentials without failing the whole digest", async () => {
    await expect(collectVercelCosts(calendarMonthPeriod(), { resourceMap: {} })).resolves.toMatchObject({ status: "not_configured", items: [] });
  });
});
