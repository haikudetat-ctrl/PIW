import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import {
  runRoofEstimate,
  SupabaseRoofEstimateWorkerRepository,
} from "@/inngest/functions/roof-estimate-worker";
import type { Database } from "@/lib/database.types";
import {
  seedActiveRoofPricingRateCard,
  seedRoofEstimatePackageSnapshot,
} from "@/integration/support/roof-pricing-fixture";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";

type OperationResult = { error: { message: string } | null };

async function requireSuccess<T extends OperationResult>(operation: PromiseLike<T>) {
  const result = await operation;
  if (result.error) throw new Error(result.error.message);
  return result;
}

describe.runIf(runIntegration)("property-level roof quote reuse", () => {
  test("copies the stored ready quote into a second lead and terminalizes its pipeline", async () => {
    const localStatus = JSON.parse(
      execFileSync("npx", ["supabase", "status", "-o", "json"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    ) as { API_URL: string; SERVICE_ROLE_KEY: string };
    const client = createClient<Database>(
      localStatus.API_URL,
      localStatus.SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const companyId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();
    const originalLeadId = crypto.randomUUID();
    const duplicateLeadId = crypto.randomUUID();
    const originalEstimateId = crypto.randomUUID();
    const duplicateEstimateId = crypto.randomUUID();
    const pipelineRunId = crypto.randomUUID();

    try {
      await requireSuccess(client.from("companies").insert({ id: companyId, name: "Quote reuse integration" }));
      await requireSuccess(client.from("properties").insert({
        id: propertyId,
        company_id: companyId,
        canonical_address: "132 Windsor Ave, Haddon Township, NJ 08108",
        resolution_status: "resolved",
      }));
      await requireSuccess(client.from("leads").insert([
        {
          id: originalLeadId,
          company_id: companyId,
          property_id: propertyId,
          name: "Morgan Original",
          phone: "+16095550100",
          email: "original@example.com",
          submitted_address: "132 Windsor Ave, Haddon Township, NJ 08108",
        },
        {
          id: duplicateLeadId,
          company_id: companyId,
          property_id: propertyId,
          name: "Riley Repeat",
          phone: "+16095550101",
          email: "repeat@example.com",
          submitted_address: "132 Windsor Avenue, Haddon Township, NJ 08108",
        },
      ]));
      await requireSuccess(client.from("pipeline_runs").insert({
        id: pipelineRunId,
        company_id: companyId,
        lead_id: duplicateLeadId,
        property_id: propertyId,
        correlation_id: crypto.randomUUID(),
        pipeline_version: 2,
        status: "validating",
      }));
      await requireSuccess(client.from("lead_consents").insert(
        ["estimate_processing", "email_contact", "sms_contact"].map((consentType) => ({
          company_id: companyId,
          lead_id: duplicateLeadId,
          consent_type: consentType,
          granted: true,
          disclosure_version: "roof-estimate-v1",
        })),
      ));
      await requireSuccess(client.from("roof_estimates").insert([
        {
          id: originalEstimateId,
          company_id: companyId,
          lead_id: originalLeadId,
          property_id: propertyId,
          status: "ready",
          total_roof_sqft: 3_100,
          roof_squares: 31,
          price_per_square_low_cents: 95_000,
          price_per_square_high_cents: 120_000,
          range_low_cents: 2_945_000,
          range_high_cents: 3_720_000,
          pricing_version: "integration-pricing-v1",
          assumptions: { market: "New Jersey average" },
        },
        {
          id: duplicateEstimateId,
          company_id: companyId,
          lead_id: duplicateLeadId,
          property_id: propertyId,
          status: "pending",
          price_per_square_low_cents: 95_000,
          price_per_square_high_cents: 120_000,
          pricing_version: "integration-pricing-v1",
          assumptions: {},
        },
      ]));
      const rateCardId = await seedActiveRoofPricingRateCard(client, companyId);
      await seedRoofEstimatePackageSnapshot(client, {
        companyId,
        estimateId: originalEstimateId,
        rateCardId,
        roofSquares: 31,
      });

      const result = await runRoofEstimate(
        {
          id: crypto.randomUUID(),
          pipelineRunId,
          correlationId: crypto.randomUUID(),
          leadId: duplicateLeadId,
          propertyId,
          canonicalAddress: "132 Windsor Ave, Haddon Township, NJ 08108",
          latitude: 39.9008,
          longitude: -75.0578,
          attempt: 1,
        },
        new SupabaseRoofEstimateWorkerRepository(client),
      );

      expect(result).toMatchObject({
        outcome: "reused_ready_quote",
        sourceEstimateId: originalEstimateId,
      });
      const { data: duplicate } = await requireSuccess(
        client
          .from("roof_estimates")
          .select("status, range_low_cents, range_high_cents, reused_from_estimate_id")
          .eq("id", duplicateEstimateId)
          .single(),
      );
      expect(duplicate).toEqual({
        status: "ready",
        range_low_cents: 2_945_000,
        range_high_cents: 3_720_000,
        reused_from_estimate_id: originalEstimateId,
      });

      const { data: pipeline } = await requireSuccess(
        client.from("pipeline_runs").select("status").eq("id", pipelineRunId).single(),
      );
      expect(pipeline?.status).toBe("complete");
      const { count: providerRequestCount, error: providerRequestError } = await client
        .from("provider_requests")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_run_id", pipelineRunId);
      if (providerRequestError) throw new Error(providerRequestError.message);
      expect(providerRequestCount).toBe(0);
    } finally {
      await client.from("context_dialer_deliveries").delete().eq("company_id", companyId);
      await client.from("estimate_deliveries").delete().eq("company_id", companyId);
      await client.from("worker_runs").delete().eq("pipeline_run_id", pipelineRunId);
      await client.from("lead_consents").delete().eq("company_id", companyId);
      await client.from("roof_estimates").delete().eq("company_id", companyId);
      await client.from("pipeline_runs").delete().eq("company_id", companyId);
      await client.from("leads").delete().eq("company_id", companyId);
      await client.from("properties").delete().eq("company_id", companyId);
      await client.from("companies").delete().eq("id", companyId);
    }
  }, 20_000);
});
