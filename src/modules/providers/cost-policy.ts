export type ProviderCostRequest = {
  deploymentEnvironment: "development" | "test" | "preview" | "production";
  paidProvidersEnabled: boolean;
  estimatedCostMicros: number;
  leadSpentMicros: number;
  leadCapMicros: number;
  providerMonthSpentMicros: number;
  providerMonthCapMicros: number;
};

export type ProviderCostDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "paid_providers_disabled"
        | "lead_budget_exceeded"
        | "provider_month_budget_exceeded";
    };

export function evaluateProviderRequest(
  input: ProviderCostRequest,
): ProviderCostDecision {
  if (!input.paidProvidersEnabled) {
    return { allowed: false, reason: "paid_providers_disabled" };
  }

  if (input.leadSpentMicros + input.estimatedCostMicros > input.leadCapMicros) {
    return { allowed: false, reason: "lead_budget_exceeded" };
  }

  if (
    input.providerMonthSpentMicros + input.estimatedCostMicros >
    input.providerMonthCapMicros
  ) {
    return { allowed: false, reason: "provider_month_budget_exceeded" };
  }

  return { allowed: true };
}
