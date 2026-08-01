export const COST_PROVIDERS = [
  "vercel",
  "supabase",
  "google_cloud",
  "digitalocean",
  "application",
] as const;

export type CostProvider = (typeof COST_PROVIDERS)[number];
export type CostKind = "actual" | "estimated" | "committed";
export type CostConfidence = "invoice" | "provider_meter" | "rate_card" | "manual";
export type CostEnvironment = "production" | "qa" | "staging" | "preview" | "shared";

export type CostLineItem = {
  provider: CostProvider;
  sourceKey: string;
  resourceKey?: string;
  service: string;
  environment: CostEnvironment;
  allocationBucket: string;
  costKind: CostKind;
  confidence: CostConfidence;
  amountMicros: number;
  usageQuantity?: number;
  usageUnit?: string;
  freeLimit?: number;
  sourceTimestamp: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
};

export type CollectorResult = {
  provider: CostProvider;
  status: "completed" | "not_configured" | "failed";
  items: CostLineItem[];
  warnings: string[];
  collectedAt: string;
};

export type CostPeriod = {
  start: string;
  endExclusive: string;
  daysInMonth: number;
  elapsedDays: number;
  timezone: string;
};

export type ResourceAllocation = {
  environment: CostEnvironment;
  allocationBucket: string;
};

export type ResourceMap = Record<string, ResourceAllocation>;

export type CostCollector = (period: CostPeriod) => Promise<CollectorResult>;

export const SHARED_ALLOCATION: ResourceAllocation = {
  environment: "shared",
  allocationBucket: "shared_platform",
};

export function allocationFor(
  resourceMap: ResourceMap,
  provider: CostProvider,
  resourceKey?: string,
): ResourceAllocation {
  if (!resourceKey) return SHARED_ALLOCATION;
  return resourceMap[`${provider}:${resourceKey}`] ?? SHARED_ALLOCATION;
}
