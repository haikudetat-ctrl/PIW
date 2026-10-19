import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {Database} from "@/lib/database.types";
import {
  getAssessmentCalculationState,
  quietEstimateState,
  toPublicPackages,
  type EstimatePackageRow,
} from "@/app/roof-estimate/[token]/public-estimate-flow";
import type {ChatEstimateSummary} from "./types";

export type {ChatEstimateSummary};

/**
 * The price-first result the estimate page shows, as data for the quote chat.
 * Same queries and the same rules as the page, so the two never disagree.
 */
export async function loadChatEstimateSummary(
  client: SupabaseClient<Database>,
  token: string,
): Promise<ChatEstimateSummary | null> {
  if (!z.uuid().safeParse(token).success) return null;
  const {data: estimate, error} = await client
    .from("roof_estimates")
    .select("id, company_id, status, range_low_cents, range_high_cents, roof_squares, roof_insight_id, updated_at, lead_id, property_id, pricing_version, assumptions, roof_estimate_packages(tier_key, display_order, measured_roof_squares, low_cents_per_square, high_cents_per_square, range_low_cents, range_high_cents, customer_name, customer_description, warranty_summary, differentiators, pricing_version, calculated_at, manufacturer_name, product_line_name)")
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw new Error("Failed to load the estimate");
  if (!estimate) return null;

  const [{data: pipeline}, {data: property}, {data: lead}, {data: insight}] = await Promise.all([
    client.from("pipeline_runs").select("status").eq("lead_id", estimate.lead_id)
      .order("started_at", {ascending: false}).limit(1).maybeSingle(),
    client.from("properties").select("canonical_address").eq("id", estimate.property_id).maybeSingle(),
    client.from("leads").select("submitted_address").eq("id", estimate.lead_id).maybeSingle(),
    estimate.roof_insight_id
      ? client.from("roof_insights").select("id, company_id, property_id, provider, lookup_status")
        .eq("id", estimate.roof_insight_id).eq("company_id", estimate.company_id)
        .eq("property_id", estimate.property_id).maybeSingle()
      : Promise.resolve({data: null}),
  ]);

  const assumptions = estimate.assumptions && typeof estimate.assumptions === "object" && !Array.isArray(estimate.assumptions)
    ? estimate.assumptions as Record<string, unknown>
    : {};
  const calculation = getAssessmentCalculationState({
    estimateStatus: estimate.status,
    pipelineStatus: pipeline?.status ?? null,
    expectedCompanyId: estimate.company_id,
    expectedPropertyId: estimate.property_id,
    insight: insight
      ? {id: insight.id, companyId: insight.company_id, propertyId: insight.property_id, provider: insight.provider, lookupStatus: insight.lookup_status}
      : null,
    lowCents: estimate.range_low_cents,
    highCents: estimate.range_high_cents,
    roofSquares: estimate.roof_squares === null ? null : Number(estimate.roof_squares),
    generatedAt: estimate.updated_at,
    pricingVersion: estimate.pricing_version,
    packages: toPublicPackages(estimate.roof_estimate_packages as EstimatePackageRow[] | null),
    adjustments: assumptions.adjustmentDisclosures,
  });
  return {
    ...quietEstimateState({estimateStatus: estimate.status, pipelineStatus: pipeline?.status ?? null, calculation}),
    address: property?.canonical_address ?? lead?.submitted_address ?? "your property",
  };
}
