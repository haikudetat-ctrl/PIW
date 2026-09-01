import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type ServiceClient = SupabaseClient<Database>;

const pricingTiers = [
  {
    tier_key: "good" as const,
    display_order: 1,
    internal_scope_code: "complete_system_test",
    customer_name: "Complete System",
    customer_description: "A dependable complete roofing system.",
    warranty_summary: "Enhanced manufacturer protection.",
    differentiators: ["Architectural finish"],
    low_cents_per_square: 80_000,
    high_cents_per_square: 97_500,
  },
  {
    tier_key: "better" as const,
    display_order: 2,
    internal_scope_code: "recommended_test",
    customer_name: "Recommended",
    customer_description: "Upgraded protection and appearance.",
    warranty_summary: "Extended material and workmanship coverage.",
    differentiators: ["Upgraded material weight"],
    low_cents_per_square: 95_000,
    high_cents_per_square: 120_000,
  },
  {
    tier_key: "best" as const,
    display_order: 3,
    internal_scope_code: "signature_system_test",
    customer_name: "Signature System",
    customer_description: "Premium finish and protection.",
    warranty_summary: "Extended workmanship coverage.",
    differentiators: ["Impact protection"],
    low_cents_per_square: 125_000,
    high_cents_per_square: 165_000,
  },
];

async function requireSuccess(
  operation: PromiseLike<{ error: { message: string } | null }>,
) {
  const result = await operation;
  if (result.error) throw new Error(result.error.message);
}

export async function seedActiveRoofPricingRateCard(
  client: ServiceClient,
  companyId: string,
) {
  const rateCardId = crypto.randomUUID();
  await requireSuccess(client.from("roof_pricing_rate_cards").insert({
    id: rateCardId,
    company_id: companyId,
    version: "integration-pricing-v1",
    name: "Integration pricing",
    market: "NJ",
    effective_from: "2026-01-01T00:00:00.000Z",
  }));
  await requireSuccess(client.from("roof_pricing_tiers").insert(
    pricingTiers.map((tier) => ({
      ...tier,
      company_id: companyId,
      rate_card_id: rateCardId,
    })),
  ));
  await requireSuccess(client.rpc("activate_roof_pricing_rate_card", {
    p_company_id: companyId,
    p_rate_card_id: rateCardId,
  }));
  return rateCardId;
}

export async function seedRoofEstimatePackageSnapshot(
  client: ServiceClient,
  input: {
    companyId: string;
    estimateId: string;
    rateCardId: string;
    roofSquares: number;
  },
) {
  await requireSuccess(client.from("roof_estimate_packages").insert(
    pricingTiers.map((tier) => ({
      company_id: input.companyId,
      estimate_id: input.estimateId,
      rate_card_id: input.rateCardId,
      tier_key: tier.tier_key,
      display_order: tier.display_order,
      measured_roof_squares: input.roofSquares,
      low_cents_per_square: tier.low_cents_per_square,
      high_cents_per_square: tier.high_cents_per_square,
      range_low_cents: Math.round(input.roofSquares * tier.low_cents_per_square),
      range_high_cents: Math.round(input.roofSquares * tier.high_cents_per_square),
      customer_name: tier.customer_name,
      customer_description: tier.customer_description,
      warranty_summary: tier.warranty_summary,
      differentiators: tier.differentiators,
      pricing_version: "integration-pricing-v1",
      calculated_at: "2026-08-31T12:00:00.000Z",
    })),
  ));
}
