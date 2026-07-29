import { expect, test } from "vitest";
import { evaluateProviderRequest } from "./cost-policy";

const base = {
  deploymentEnvironment: "production" as const,
  paidProvidersEnabled: true,
  estimatedCostMicros: 250_000,
  leadSpentMicros: 0,
  leadCapMicros: 5_000_000,
  providerMonthSpentMicros: 0,
  providerMonthCapMicros: 50_000_000,
};

test("blocks paid requests in preview regardless of available budget", () => {
  expect(
    evaluateProviderRequest({
      deploymentEnvironment: "preview",
      paidProvidersEnabled: false,
      estimatedCostMicros: 250_000,
      leadSpentMicros: 0,
      leadCapMicros: 5_000_000,
      providerMonthSpentMicros: 0,
      providerMonthCapMicros: 50_000_000,
    }),
  ).toEqual({ allowed: false, reason: "paid_providers_disabled" });
});

test("allows a request exactly at the lead cap boundary", () => {
  expect(
    evaluateProviderRequest({
      ...base,
      leadSpentMicros: 4_750_000,
      estimatedCostMicros: 250_000,
      leadCapMicros: 5_000_000,
    }),
  ).toEqual({ allowed: true });
});

test("blocks a request that would exceed the lead cap", () => {
  expect(
    evaluateProviderRequest({
      ...base,
      leadSpentMicros: 4_750_001,
      estimatedCostMicros: 250_000,
      leadCapMicros: 5_000_000,
    }),
  ).toEqual({ allowed: false, reason: "lead_budget_exceeded" });
});

test("blocks a request that would exceed the monthly provider cap", () => {
  expect(
    evaluateProviderRequest({
      ...base,
      providerMonthSpentMicros: 49_999_999,
      estimatedCostMicros: 250_000,
      providerMonthCapMicros: 50_000_000,
    }),
  ).toEqual({ allowed: false, reason: "provider_month_budget_exceeded" });
});

test("allows a production paid call only when paid providers are enabled", () => {
  expect(
    evaluateProviderRequest({ ...base, paidProvidersEnabled: true }),
  ).toEqual({ allowed: true });
  expect(
    evaluateProviderRequest({ ...base, paidProvidersEnabled: false }),
  ).toEqual({ allowed: false, reason: "paid_providers_disabled" });
});
