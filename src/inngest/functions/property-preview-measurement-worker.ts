import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/database.types";
import type { GoogleSolarInsight } from "@/domain/roof-estimate";
import { parseServerEnv } from "@/lib/env/server";
import { inngest, propertyPreviewMeasurementRequested } from "@/inngest/client";
import { SupabaseRoofEstimateWorkerRepository } from "@/inngest/functions/roof-estimate-worker";
import { createGoogleSolarProvider } from "@/modules/providers/adapters/google-solar";
import {
  measurePropertyPreview,
  type MeasurePreviewDependencies,
} from "@/modules/property-preview/measure-preview";

// Measures the roof for an anonymous preview. Writes go to the same
// roof_insights cache the lead worker reads, keyed by company and normalized
// canonical address, so conversion never pays for a second Solar call.

export function createPreviewMeasurementDependencies(): MeasurePreviewDependencies {
  const client = createServiceClient();
  const estimateRepository = new SupabaseRoofEstimateWorkerRepository(client);

  return {
    async loadPreview({companyId, previewId}) {
      const {data, error} = await client
        .from("property_previews")
        .select("property_id, measurement_status, canonical_address, latitude, longitude")
        .eq("company_id", companyId)
        .eq("id", previewId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error("Failed to load property preview");
      if (!data) return null;
      return {
        propertyId: data.property_id,
        measurementStatus: data.measurement_status as "pending",
        canonicalAddress: data.canonical_address,
        latitude: data.latitude,
        longitude: data.longitude,
      };
    },
    findCachedInsight: (input) => estimateRepository.findCachedInsight(input),
    reserveSolarCall: () => estimateRepository.reserveSolarCall(),
    async beginProviderRequest({companyId, previewId}) {
      const requestKey = `roof.measurement:preview:${previewId}`;
      const {data: inserted, error} = await client
        .from("provider_requests")
        .insert({
          company_id: companyId,
          capability: "roof.measurement",
          provider: "google_solar",
          request_key: requestKey,
          status: "requested",
        })
        .select("id")
        .single();
      if (!error && inserted) return {providerRequestId: inserted.id};
      const {data: existing, error: existingError} = await client
        .from("provider_requests")
        .select("id")
        .eq("request_key", requestKey)
        .single();
      if (existingError || !existing) throw new Error("Failed to start preview Solar request");
      return {providerRequestId: existing.id};
    },
    async measureRoof({companyId, previewId, latitude, longitude}) {
      const environment = parseServerEnv(process.env);
      if (!environment.PAID_PROVIDERS_ENABLED || !environment.GOOGLE_MAPS_API_KEY) {
        throw new Error("Google property intelligence is not enabled");
      }
      const provider = createGoogleSolarProvider({apiKey: environment.GOOGLE_MAPS_API_KEY, enabled: true});
      const result = await provider.execute(
        {latitude, longitude},
        {
          companyId,
          pipelineRunId: previewId,
          correlationId: previewId,
          requestKey: `roof.measurement:preview:${previewId}`,
          deploymentEnvironment: environment.DEPLOYMENT_ENV,
        },
      );
      return {insight: result.value, retrievedAt: result.retrievedAt, sourceIdentifier: result.sourceIdentifier};
    },
    async persistInsight(input) {
      const insight = input.insight as GoogleSolarInsight;
      const success = insight.status === "success" ? insight : null;
      const {data, error} = await client
        .from("roof_insights")
        .upsert(
          {
            company_id: input.companyId,
            property_id: input.propertyId,
            provider: "google_solar",
            normalized_address: input.normalizedAddress,
            lookup_status: insight.status,
            building_name: success?.buildingName ?? null,
            latitude: success?.latitude ?? input.latitude,
            longitude: success?.longitude ?? input.longitude,
            imagery_date: success?.imageryDate ?? null,
            imagery_quality: success?.imageryQuality ?? null,
            roof_segments: (success?.roofSegments ?? []) as unknown as Json,
            plane_count: success?.roofSegments.length ?? null,
            total_roof_sqft: success?.totalRoofSqft ?? null,
            raw_response: insight.rawResponse as Json | null,
            source_retrieved_at: input.retrievedAt,
            updated_at: new Date().toISOString(),
          },
          {onConflict: "company_id,provider,normalized_address"},
        )
        .select("id")
        .single();
      if (error || !data) throw new Error("Failed to persist preview roof insight");
      return {id: data.id};
    },
    completeProviderRequest: (input) => estimateRepository.completeProviderRequest({
      ...input,
      insight: input.insight as GoogleSolarInsight,
    }),
    async failProviderRequest({companyId, providerRequestId}) {
      const {error} = await client
        .from("provider_requests")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_code: "preview_measurement_failed",
          error_message: "Google Solar measurement failed for a property preview",
        })
        .eq("id", providerRequestId)
        .eq("company_id", companyId);
      if (error) throw new Error("Failed to record preview Solar failure");
    },
    async complete({companyId, previewId, roofInsightId, status}) {
      const {error} = await client
        .from("property_previews")
        .update({measurement_status: status, roof_insight_id: roofInsightId, updated_at: new Date().toISOString()})
        .eq("company_id", companyId)
        .eq("id", previewId)
        .eq("measurement_status", "pending");
      if (error) throw new Error("Failed to complete preview measurement");
    },
    async setStatus({companyId, previewId, status}) {
      const {error} = await client
        .from("property_previews")
        .update({
          measurement_status: status,
          ...(status === "skipped" ? {reveal_mode: "skipped"} : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", previewId)
        .eq("measurement_status", "pending");
      if (error) throw new Error("Failed to update preview measurement status");
    },
  };
}

export const propertyPreviewMeasurementWorker = inngest.createFunction(
  {
    id: "property-preview-measurement-worker",
    triggers: {event: propertyPreviewMeasurementRequested},
    retries: 2,
  },
  async ({event}) => {
    const result = await measurePropertyPreview(
      {companyId: event.data.companyId, previewId: event.data.previewId},
      createPreviewMeasurementDependencies(),
    );
    console.info("property_preview_measurement", {outcome: result.kind});
    return result;
  },
);
