import type { CollectorResult, CostPeriod, ResourceMap } from "../contracts";
import { allocationFor } from "../contracts";
import { requireOk } from "../http";

type VercelCharge = {
  ServiceName?: string;
  PricingQuantity?: number;
  PricingUnit?: string;
  EffectiveCost?: number;
  BilledCost?: number;
  ChargePeriodStart?: string;
  ChargePeriodEnd?: string;
  Tags?: { ProjectId?: string; ProjectName?: string };
};

export async function collectVercelCosts(
  period: CostPeriod,
  config: { token?: string; teamId?: string; resourceMap: ResourceMap },
  fetcher: typeof fetch = fetch,
): Promise<CollectorResult> {
  const collectedAt = new Date().toISOString();
  if (!config.token || !config.teamId) {
    return { provider: "vercel", status: "not_configured", items: [], warnings: ["Vercel billing token/team ID not configured"], collectedAt };
  }
  try {
    const query = new URLSearchParams({
      from: `${period.start}T00:00:00.000Z`,
      to: collectedAt,
      teamId: config.teamId,
    });
    const response = await requireOk(await fetcher(`https://api.vercel.com/v1/billing/charges?${query}`, {
      headers: { authorization: `Bearer ${config.token}` },
    }), "Vercel");
    const body = await response.text();
    const charges = body.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as VercelCharge);
    const trackedKeys = Object.keys(config.resourceMap).filter((key) => key.startsWith("vercel:"));
    const scopedCharges = charges.filter((charge) => {
      const resourceKey = charge.Tags?.ProjectId ?? charge.Tags?.ProjectName;
      return !resourceKey || !trackedKeys.length || trackedKeys.includes(`vercel:${resourceKey}`);
    });
    const excluded = charges.length - scopedCharges.length;
    return {
      provider: "vercel",
      status: "completed",
      collectedAt,
      warnings: excluded ? [`${excluded} Vercel charge rows for untracked projects were excluded`] : [],
      items: scopedCharges.map((charge, index) => {
        const resourceKey = charge.Tags?.ProjectId ?? charge.Tags?.ProjectName;
        const allocation = allocationFor(config.resourceMap, "vercel", resourceKey);
        return {
          provider: "vercel" as const,
          sourceKey: `${charge.ServiceName ?? "unknown"}:${resourceKey ?? "shared"}:${charge.ChargePeriodStart ?? index}`,
          resourceKey,
          service: charge.ServiceName ?? "Unknown Vercel service",
          ...allocation,
          costKind: "actual" as const,
          confidence: "provider_meter" as const,
          amountMicros: Math.round((charge.BilledCost ?? charge.EffectiveCost ?? 0) * 1_000_000),
          usageQuantity: charge.PricingQuantity,
          usageUnit: charge.PricingUnit,
          sourceTimestamp: charge.ChargePeriodEnd ?? collectedAt,
          sourceUrl: "https://vercel.com/docs/cli/usage",
          metadata: { effectiveCostUsd: charge.EffectiveCost ?? null, projectName: charge.Tags?.ProjectName ?? null },
        };
      }),
    };
  } catch (error) {
    return { provider: "vercel", status: "failed", items: [], warnings: [error instanceof Error ? error.message : "Vercel collection failed"], collectedAt };
  }
}
