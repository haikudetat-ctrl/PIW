import type { CollectorResult, CostLineItem, CostPeriod, CostProvider } from "./contracts";

export type ProviderCostSummary = {
  provider: CostProvider;
  currentMicros: number;
  forecastMicros: number;
  confidence: string;
};

export type CostDigestSummary = {
  periodStart: string;
  budgetMicros: number;
  currentMicros: number;
  forecastMicros: number;
  budgetUsedPercent: number;
  forecastPercent: number;
  remainingMicros: number;
  safeDailyMicros: number;
  providers: ProviderCostSummary[];
  apiUsage: Array<{ name: string; used: number; limit?: number; percent?: number }>;
  warnings: string[];
  statuses: Record<string, string>;
};

export function buildCostSummary(
  period: CostPeriod,
  budgetMicros: number,
  results: CollectorResult[],
): CostDigestSummary {
  const monetary = results.flatMap((result) => result.items).filter((item) => item.provider !== "application");
  const providers = new Map<CostProvider, CostLineItem[]>();
  for (const item of monetary) providers.set(item.provider, [...(providers.get(item.provider) ?? []), item]);
  const providerSummaries = [...providers].map(([provider, items]) => {
    const actual = sum(items.filter((item) => item.costKind === "actual"));
    const estimated = sum(items.filter((item) => item.costKind === "estimated"));
    const committed = sum(items.filter((item) => item.costKind === "committed"));
    const variable = actual !== 0 ? actual : estimated;
    // Committed values are a month-end floor, not an extra charge to stack on
    // top of an invoice preview for the same provider.
    const currentMicros = variable !== 0 ? variable : committed;
    const forecastMicros = Math.max(currentMicros, committed, Math.round(variable * period.daysInMonth / period.elapsedDays));
    const confidence = items.some((item) => item.confidence === "invoice")
      ? "invoice"
      : items.some((item) => item.confidence === "provider_meter") ? "provider meter" : "estimate";
    return { provider, currentMicros, forecastMicros, confidence };
  }).sort((a, b) => b.currentMicros - a.currentMicros);
  const currentMicros = providerSummaries.reduce((total, provider) => total + provider.currentMicros, 0);
  const forecastMicros = providerSummaries.reduce((total, provider) => total + provider.forecastMicros, 0);
  const remainingMicros = budgetMicros - currentMicros;
  const remainingDays = Math.max(1, period.daysInMonth - period.elapsedDays);
  const applicationItems = results.find((result) => result.provider === "application")?.items ?? [];
  return {
    periodStart: period.start,
    budgetMicros,
    currentMicros,
    forecastMicros,
    budgetUsedPercent: budgetMicros ? currentMicros / budgetMicros * 100 : 0,
    forecastPercent: budgetMicros ? forecastMicros / budgetMicros * 100 : 0,
    remainingMicros,
    safeDailyMicros: Math.max(0, Math.round(remainingMicros / remainingDays)),
    providers: providerSummaries,
    apiUsage: applicationItems.filter((item) => item.usageQuantity !== undefined).map((item) => ({
      name: item.service,
      used: item.usageQuantity ?? 0,
      limit: item.freeLimit,
      percent: item.freeLimit ? (item.usageQuantity ?? 0) / item.freeLimit * 100 : undefined,
    })),
    warnings: results.flatMap((result) => result.warnings),
    statuses: Object.fromEntries(results.map((result) => [result.provider, result.status])),
  };
}

function sum(items: CostLineItem[]) {
  return items.reduce((total, item) => total + item.amountMicros, 0);
}
