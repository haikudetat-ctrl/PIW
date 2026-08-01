import type { CollectorResult, CostPeriod } from "./contracts";

export type ApplicationUsageData = {
  monthlyUsage: Array<{ api_name: string; reserved_count: number; call_limit: number; updated_at: string }>;
  requests: Array<{ provider: string; status: string }>;
  estimatedCostMicros: number;
  actualCostMicros: number;
};

export function collectApplicationUsage(
  _period: CostPeriod,
  data: ApplicationUsageData,
): CollectorResult {
  const collectedAt = new Date().toISOString();
  const byProvider = new Map<string, Record<string, number>>();
  for (const request of data.requests) {
    const statuses = byProvider.get(request.provider) ?? {};
    statuses[request.status] = (statuses[request.status] ?? 0) + 1;
    byProvider.set(request.provider, statuses);
  }
  const requestItems = [...byProvider].map(([provider, statuses]) => ({
    provider: "application" as const,
    sourceKey: `requests:${provider}`,
    resourceKey: provider,
    service: `${provider} API requests`,
    environment: "production" as const,
    allocationBucket: "api_calls",
    costKind: "estimated" as const,
    confidence: "provider_meter" as const,
    amountMicros: 0,
    usageQuantity: Object.values(statuses).reduce((total, count) => total + count, 0),
    usageUnit: "calls",
    sourceTimestamp: collectedAt,
    metadata: { statuses, trackedEstimatedCostMicros: data.estimatedCostMicros, trackedActualCostMicros: data.actualCostMicros },
  }));
  const quotaItems = data.monthlyUsage.map((usage) => ({
    provider: "application" as const,
    sourceKey: `quota:${usage.api_name}`,
    resourceKey: usage.api_name,
    service: usage.api_name,
    environment: "production" as const,
    allocationBucket: "api_calls",
    costKind: "estimated" as const,
    confidence: "provider_meter" as const,
    amountMicros: 0,
    usageQuantity: usage.reserved_count,
    usageUnit: "calls",
    freeLimit: usage.call_limit,
    sourceTimestamp: usage.updated_at,
  }));
  return { provider: "application", status: "completed", warnings: [], items: [...requestItems, ...quotaItems], collectedAt };
}
