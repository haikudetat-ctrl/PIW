import "server-only";
import {after} from "next/server";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";
import {
  parseRoofEstimateEnvelope,
  runRoofEstimate,
  SupabaseRoofEstimateWorkerRepository,
} from "@/inngest/functions/roof-estimate-worker";
import {normalizeAddressForMatching} from "@/modules/property-identity/normalize-address";
import type {ConversionPricingDependencies} from "./price-at-conversion";

export function createSupabaseConversionPricing(client: SupabaseClient<Database>): ConversionPricingDependencies {
  return {
    async findDiscoveryEvent({companyId, leadId}) {
      const {data: run, error: runError} = await client
        .from("pipeline_runs")
        .select("id")
        .eq("company_id", companyId)
        .eq("lead_id", leadId)
        .order("started_at", {ascending: false})
        .limit(1)
        .maybeSingle();
      if (runError) throw new Error("Failed to load the pipeline run");
      if (!run) return null;
      const {data: event, error: eventError} = await client
        .from("domain_events")
        .select("payload")
        .eq("company_id", companyId)
        .eq("pipeline_run_id", run.id)
        .eq("event_name", "property/discovery_requested")
        .order("occurred_at", {ascending: false})
        .limit(1)
        .maybeSingle();
      if (eventError) throw new Error("Failed to load the discovery event");
      const parsed = event ? parseRoofEstimateEnvelope(event.payload) : null;
      // Only the event for this lead's own run, with coordinates to price from.
      return parsed && parsed.leadId === leadId && parsed.pipelineRunId === run.id
        && parsed.latitude !== null && parsed.longitude !== null
        ? parsed
        : null;
    },
    async hasCachedMeasurement({companyId, event}) {
      const {data, error} = await client
        .from("roof_insights")
        .select("id")
        .eq("company_id", companyId)
        .eq("provider", "google_solar")
        .eq("normalized_address", normalizeAddressForMatching(event.canonicalAddress))
        .gt("cache_expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("Failed to read the roof measurement cache");
      return Boolean(data);
    },
    run: (event) => runRoofEstimate(event, new SupabaseRoofEstimateWorkerRepository(client)),
    defer: (work) => after(() => work),
    log: (record) => console.info(JSON.stringify({level: "info", ...record})),
  };
}
