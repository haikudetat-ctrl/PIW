import { z } from "zod";
import type { CostEnvironment, ResourceMap } from "./contracts";

const environment = z.enum(["production", "qa", "staging", "preview", "shared"]);
const allocation = z.object({
  environment,
  allocationBucket: z.string().min(1),
});

export function parseResourceMap(value?: string): ResourceMap {
  if (!value) return {};
  return z.record(z.string(), allocation).parse(JSON.parse(value));
}

export type SupabaseCostConfig = {
  organizations: Array<{
    slug: string;
    name: string;
    planMonthlyUsd: number;
    computeCreditsUsd: number;
    projects: Array<{
      ref: string;
      name: string;
      environment: CostEnvironment;
      computeMonthlyUsd: number;
    }>;
    usage: Array<{
      service: string;
      quantity: number;
      unit: string;
      freeLimit: number;
      overageUnitUsd: number;
    }>;
  }>;
};

const supabaseCostConfig = z.object({
  organizations: z.array(z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    planMonthlyUsd: z.number().nonnegative(),
    computeCreditsUsd: z.number().nonnegative().default(0),
    projects: z.array(z.object({
      ref: z.string().min(1),
      name: z.string().min(1),
      environment,
      computeMonthlyUsd: z.number().nonnegative(),
    })).default([]),
    usage: z.array(z.object({
      service: z.string().min(1),
      quantity: z.number().nonnegative(),
      unit: z.string().min(1),
      freeLimit: z.number().nonnegative(),
      overageUnitUsd: z.number().nonnegative(),
    })).default([]),
  })),
});

export function parseSupabaseCostConfig(value?: string): SupabaseCostConfig | undefined {
  if (!value) return undefined;
  return supabaseCostConfig.parse(JSON.parse(value));
}

export function usdToMicros(value: number) {
  return Math.round(value * 1_000_000);
}
