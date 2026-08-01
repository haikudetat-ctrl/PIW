import type { CollectorResult, CostPeriod } from "../contracts";
import type { SupabaseCostConfig } from "../config";
import { usdToMicros } from "../config";

export async function collectSupabaseCosts(
  _period: CostPeriod,
  config?: SupabaseCostConfig,
): Promise<CollectorResult> {
  const collectedAt = new Date().toISOString();
  if (!config) {
    return { provider: "supabase", status: "not_configured", items: [], warnings: ["Supabase cost configuration not configured; dashboard invoice data has no supported billing API"], collectedAt };
  }
  const items = config.organizations.flatMap((organization) => {
    const shared = [{
      provider: "supabase" as const,
      sourceKey: `${organization.slug}:plan`,
      resourceKey: organization.slug,
      service: `${organization.name} subscription`,
      environment: "shared" as const,
      allocationBucket: "shared_platform",
      costKind: "committed" as const,
      confidence: "manual" as const,
      amountMicros: usdToMicros(organization.planMonthlyUsd - organization.computeCreditsUsd),
      sourceTimestamp: collectedAt,
      sourceUrl: "https://supabase.com/docs/guides/platform/billing-on-supabase",
      metadata: { planMonthlyUsd: organization.planMonthlyUsd, computeCreditsUsd: organization.computeCreditsUsd },
    }];
    const projects = organization.projects.map((project) => ({
      provider: "supabase" as const,
      sourceKey: `${organization.slug}:compute:${project.ref}`,
      resourceKey: project.ref,
      service: `${project.name} compute`,
      environment: project.environment,
      allocationBucket: project.name,
      costKind: "committed" as const,
      confidence: "manual" as const,
      amountMicros: usdToMicros(project.computeMonthlyUsd),
      sourceTimestamp: collectedAt,
      sourceUrl: "https://supabase.com/docs/guides/platform/billing-on-supabase",
    }));
    const usage = organization.usage.map((usageItem) => ({
      provider: "supabase" as const,
      sourceKey: `${organization.slug}:usage:${usageItem.service}`,
      resourceKey: organization.slug,
      service: usageItem.service,
      environment: "shared" as const,
      allocationBucket: "shared_platform",
      costKind: "estimated" as const,
      confidence: "manual" as const,
      amountMicros: usdToMicros(Math.max(0, usageItem.quantity - usageItem.freeLimit) * usageItem.overageUnitUsd),
      usageQuantity: usageItem.quantity,
      usageUnit: usageItem.unit,
      freeLimit: usageItem.freeLimit,
      sourceTimestamp: collectedAt,
      sourceUrl: "https://supabase.com/docs/guides/platform/manage-your-usage",
    }));
    return [...shared, ...projects, ...usage];
  });
  return { provider: "supabase", status: "completed", items, warnings: ["Supabase figures are rate-card estimates; reconcile against Upcoming Invoice monthly"], collectedAt };
}
