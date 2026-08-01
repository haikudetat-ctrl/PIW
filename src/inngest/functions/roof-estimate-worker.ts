import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculatePreliminaryRoofEstimate,
  googleSolarInsightSchema,
  type GoogleSolarInsight,
} from "@/domain/roof-estimate";
import { propertyDiscoveryRequestedDataSchema } from "@/domain/events";
import { inngest, propertyDiscoveryRequested } from "@/inngest/client";
import type { Database, Json } from "@/lib/database.types";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeAddressForMatching } from "@/modules/property-identity/normalize-address";
import { createGoogleSolarProvider } from "@/modules/providers/adapters/google-solar";

const SOLAR_MONTHLY_CALL_LIMIT = 9_500;

type RoofEstimateEvent = {
  id: string;
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
  propertyId: string;
  canonicalAddress: string;
  latitude: number | null;
  longitude: number | null;
  attempt: number;
};

type EstimateScope = {
  companyId: string;
  estimateId: string;
  name: string;
  phone: string;
  email: string;
};

type WorkerRunRecord = { id: string; status: string };

export type RoofInsightRecord = {
  id: string;
  insight: GoogleSolarInsight;
  retrievedAt: string;
};

export interface RoofEstimateWorkerRepository {
  assertConsentedScope(event: RoofEstimateEvent): Promise<EstimateScope>;
  upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord>;
  startEstimating(input: { pipelineRunId: string; companyId: string }): Promise<void>;
  findCachedInsight(input: {
    companyId: string;
    normalizedAddress: string;
  }): Promise<RoofInsightRecord | null>;
  beginProviderRequest(input: {
    pipelineRunId: string;
    companyId: string;
    workerRunId: string;
    attempt: number;
  }): Promise<{ providerRequestId: string }>;
  markProviderCacheHit(input: {
    providerRequestId: string;
    companyId: string;
  }): Promise<void>;
  reserveSolarCall(): Promise<{ allowed: boolean; reservedCount: number }>;
  measureRoof(input: {
    latitude: number;
    longitude: number;
    companyId: string;
    pipelineRunId: string;
    correlationId: string;
    attempt: number;
  }): Promise<{ insight: GoogleSolarInsight; retrievedAt: string; sourceIdentifier: string }>;
  persistInsight(input: {
    event: RoofEstimateEvent;
    companyId: string;
    normalizedAddress: string;
    insight: GoogleSolarInsight;
    retrievedAt: string;
  }): Promise<RoofInsightRecord>;
  completeProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
    insight: GoogleSolarInsight;
    retrievedAt: string;
    sourceIdentifier: string;
  }): Promise<void>;
  blockProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
  }): Promise<void>;
  failProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
  }): Promise<void>;
  finalizeEstimate(input: {
    estimateId: string;
    companyId: string;
    insightRecord: RoofInsightRecord | null;
    status: "ready" | "no_coverage" | "quota_exhausted" | "failed";
    failureReason?: string;
  }): Promise<void>;
  queueDeliveries(input: {
    estimateId: string;
    companyId: string;
    leadId: string;
    name: string;
    phone: string;
    email: string;
    status: "ready" | "no_coverage" | "quota_exhausted" | "failed";
    estimate?: ReturnType<typeof calculatePreliminaryRoofEstimate>;
  }): Promise<void>;
  queueContextDialer(input: {
    estimateId: string;
    companyId: string;
    leadId: string;
    pipelineRunId: string;
  }): Promise<void>;
  completePipeline(input: {
    pipelineRunId: string;
    propertyId: string;
    companyId: string;
  }): Promise<void>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
}

export async function runRoofEstimate(
  event: RoofEstimateEvent,
  repository: RoofEstimateWorkerRepository,
) {
  const scope = await repository.assertConsentedScope(event);
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey: `roof-estimate-worker:${event.pipelineRunId}:${event.attempt}`,
  });
  if (workerRun.status === "completed") {
    return { outcome: "already_completed" as const, workerRunId: workerRun.id };
  }

  await repository.startEstimating({
    pipelineRunId: event.pipelineRunId,
    companyId: scope.companyId,
  });

  const normalizedAddress = normalizeAddressForMatching(event.canonicalAddress);
  const { providerRequestId } = await repository.beginProviderRequest({
    pipelineRunId: event.pipelineRunId,
    companyId: scope.companyId,
    workerRunId: workerRun.id,
    attempt: event.attempt,
  });

  let insightRecord = await repository.findCachedInsight({
    companyId: scope.companyId,
    normalizedAddress,
  });
  if (insightRecord) {
    await repository.markProviderCacheHit({
      providerRequestId,
      companyId: scope.companyId,
    });
  } else {
    const reservation = await repository.reserveSolarCall();
    if (!reservation.allowed) {
      await repository.blockProviderRequest({
        providerRequestId,
        companyId: scope.companyId,
      });
      await repository.finalizeEstimate({
        estimateId: scope.estimateId,
        companyId: scope.companyId,
        insightRecord: null,
        status: "quota_exhausted",
        failureReason: "Google Solar monthly call budget reached",
      });
      await repository.queueDeliveries({
        estimateId: scope.estimateId,
        companyId: scope.companyId,
        leadId: event.leadId,
        name: scope.name,
        phone: scope.phone,
        email: scope.email,
        status: "quota_exhausted",
      });
      await repository.queueContextDialer({
        estimateId: scope.estimateId,
        companyId: scope.companyId,
        leadId: event.leadId,
        pipelineRunId: event.pipelineRunId,
      });
      await repository.completePipeline({
        pipelineRunId: event.pipelineRunId,
        propertyId: event.propertyId,
        companyId: scope.companyId,
      });
      await repository.markWorkerRunCompleted(workerRun.id);
      return { outcome: "quota_exhausted" as const, workerRunId: workerRun.id };
    }

    if (event.latitude === null || event.longitude === null) {
      throw new Error("Google Solar requires validated coordinates");
    }
    try {
      const measured = await repository.measureRoof({
        latitude: event.latitude,
        longitude: event.longitude,
        companyId: scope.companyId,
        pipelineRunId: event.pipelineRunId,
        correlationId: event.correlationId,
        attempt: event.attempt,
      });
      insightRecord = await repository.persistInsight({
        event,
        companyId: scope.companyId,
        normalizedAddress,
        insight: measured.insight,
        retrievedAt: measured.retrievedAt,
      });
      await repository.completeProviderRequest({
        providerRequestId,
        companyId: scope.companyId,
        insight: measured.insight,
        retrievedAt: measured.retrievedAt,
        sourceIdentifier: measured.sourceIdentifier,
      });
    } catch (error) {
      await repository.failProviderRequest({
        providerRequestId,
        companyId: scope.companyId,
      });
      await repository.finalizeEstimate({
        estimateId: scope.estimateId,
        companyId: scope.companyId,
        insightRecord: null,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Roof lookup failed",
      });
      await repository.queueContextDialer({
        estimateId: scope.estimateId,
        companyId: scope.companyId,
        leadId: event.leadId,
        pipelineRunId: event.pipelineRunId,
      });
      throw error;
    }
  }

  const insight = insightRecord.insight;
  const status = insight.status === "success" ? "ready" : "no_coverage";
  const estimate =
    insight.status === "success"
      ? calculatePreliminaryRoofEstimate(insight.totalRoofSqft)
      : undefined;
  await repository.finalizeEstimate({
    estimateId: scope.estimateId,
    companyId: scope.companyId,
    insightRecord,
    status,
    failureReason:
      status === "no_coverage" ? "Google Solar has no building coverage" : undefined,
  });
  await repository.queueDeliveries({
    estimateId: scope.estimateId,
    companyId: scope.companyId,
    leadId: event.leadId,
    name: scope.name,
    phone: scope.phone,
    email: scope.email,
    status,
    estimate,
  });
  await repository.queueContextDialer({
    estimateId: scope.estimateId,
    companyId: scope.companyId,
    leadId: event.leadId,
    pipelineRunId: event.pipelineRunId,
  });
  await repository.completePipeline({
    pipelineRunId: event.pipelineRunId,
    propertyId: event.propertyId,
    companyId: scope.companyId,
  });
  await repository.markWorkerRunCompleted(workerRun.id);
  return { outcome: status, workerRunId: workerRun.id };
}

export class SupabaseRoofEstimateWorkerRepository
  implements RoofEstimateWorkerRepository
{
  constructor(
    private readonly client: SupabaseClient<Database> = createServiceClient(),
  ) {}

  async assertConsentedScope(event: RoofEstimateEvent): Promise<EstimateScope> {
    const [{ data: run }, { data: lead }, { data: estimate }, { data: consents }] =
      await Promise.all([
        this.client
          .from("pipeline_runs")
          .select("company_id, lead_id, property_id")
          .eq("id", event.pipelineRunId)
          .single(),
        this.client
          .from("leads")
          .select("company_id, property_id, name, phone, email")
          .eq("id", event.leadId)
          .single(),
        this.client
          .from("roof_estimates")
          .select("id, company_id, property_id")
          .eq("lead_id", event.leadId)
          .single(),
        this.client
          .from("lead_consents")
          .select("consent_type, granted")
          .eq("lead_id", event.leadId),
      ]);
    const granted = new Set(
      (consents ?? []).filter((item) => item.granted).map((item) => item.consent_type),
    );
    if (
      !run ||
      !lead ||
      !estimate ||
      run.lead_id !== event.leadId ||
      run.property_id !== event.propertyId ||
      lead.property_id !== event.propertyId ||
      estimate.property_id !== event.propertyId ||
      run.company_id !== lead.company_id ||
      run.company_id !== estimate.company_id ||
      !["estimate_processing", "email_contact", "sms_contact"].every((type) =>
        granted.has(type),
      )
    ) {
      throw new Error("Roof-estimate scope or consent mismatch");
    }
    return {
      companyId: run.company_id,
      estimateId: estimate.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
    };
  }

  async upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }) {
    const { data: inserted, error } = await this.client
      .from("worker_runs")
      .insert({
        pipeline_run_id: input.pipelineRunId,
        worker_type: "roof_estimate",
        worker_version: 1,
        idempotency_key: input.idempotencyKey,
        status: "queued",
        started_at: new Date().toISOString(),
      })
      .select("id, status")
      .single();
    if (!error && inserted) return inserted;
    const { data: existing, error: selectError } = await this.client
      .from("worker_runs")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    if (selectError || !existing) throw new Error("Failed to start roof-estimate worker");
    return existing;
  }

  async startEstimating(input: { pipelineRunId: string; companyId: string }) {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({ status: "estimating" })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId)
      .in("status", ["validating", "enriching", "estimating"]);
    if (error) throw new Error("Failed to start roof estimation");
  }

  async findCachedInsight(input: { companyId: string; normalizedAddress: string }) {
    const { data, error } = await this.client
      .from("roof_insights")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("provider", "google_solar")
      .eq("normalized_address", input.normalizedAddress)
      .gt("cache_expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error("Failed to read roof-insight cache");
    if (!data) return null;
    const insight = googleSolarInsightSchema.parse(
      data.lookup_status === "success"
        ? {
            status: "success",
            buildingName: data.building_name,
            latitude: Number(data.latitude),
            longitude: Number(data.longitude),
            imageryDate: data.imagery_date,
            imageryQuality: data.imagery_quality,
            roofSegments: data.roof_segments,
            totalRoofSqft: Number(data.total_roof_sqft),
            rawResponse: data.raw_response,
          }
        : { status: "no_coverage", rawResponse: data.raw_response },
    );
    return { id: data.id, insight, retrievedAt: data.source_retrieved_at };
  }

  async beginProviderRequest(input: {
    pipelineRunId: string;
    companyId: string;
    workerRunId: string;
    attempt: number;
  }) {
    const requestKey = `roof.measurement:${input.pipelineRunId}:${input.attempt}`;
    const { data: inserted, error } = await this.client
      .from("provider_requests")
      .insert({
        company_id: input.companyId,
        pipeline_run_id: input.pipelineRunId,
        worker_run_id: input.workerRunId,
        attempt: input.attempt,
        capability: "roof.measurement",
        provider: "google_solar",
        request_key: requestKey,
        status: "requested",
      })
      .select("id")
      .single();
    if (!error && inserted) return { providerRequestId: inserted.id };
    const { data: existing, error: existingError } = await this.client
      .from("provider_requests")
      .select("id")
      .eq("request_key", requestKey)
      .single();
    if (existingError || !existing) throw new Error("Failed to start Solar provider request");
    return { providerRequestId: existing.id };
  }

  async markProviderCacheHit(input: { providerRequestId: string; companyId: string }) {
    const { error } = await this.client
      .from("provider_requests")
      .update({ status: "cache_hit", completed_at: new Date().toISOString() })
      .eq("id", input.providerRequestId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to record Solar cache hit");
  }

  async reserveSolarCall() {
    const today = new Date();
    const periodStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { data, error } = await this.client.rpc("reserve_provider_usage", {
      p_api_name: "google_solar_building_insights",
      p_period_start: periodStart,
      p_limit: SOLAR_MONTHLY_CALL_LIMIT,
    });
    if (error || !data?.[0]) throw new Error("Failed to reserve Google Solar usage");
    return { allowed: data[0].allowed, reservedCount: data[0].reserved_count };
  }

  async measureRoof(input: {
    latitude: number;
    longitude: number;
    companyId: string;
    pipelineRunId: string;
    correlationId: string;
    attempt: number;
  }) {
    const environment = parseServerEnv(process.env);
    if (!environment.PAID_PROVIDERS_ENABLED || !environment.GOOGLE_MAPS_API_KEY) {
      throw new Error("Google property intelligence is not enabled");
    }
    const provider = createGoogleSolarProvider({
      apiKey: environment.GOOGLE_MAPS_API_KEY,
      enabled: true,
    });
    const result = await provider.execute(
      { latitude: input.latitude, longitude: input.longitude },
      {
        companyId: input.companyId,
        pipelineRunId: input?.pipelineRunId,
        correlationId: input?.correlationId,
        requestKey: `roof.measurement:${input.pipelineRunId}:${input.attempt}`,
        deploymentEnvironment: environment.DEPLOYMENT_ENV,
      },
    );
    return {
      insight: result.value,
      retrievedAt: result.retrievedAt,
      sourceIdentifier: result.sourceIdentifier,
    };
  }

  async persistInsight(input: {
    event: RoofEstimateEvent;
    companyId: string;
    normalizedAddress: string;
    insight: GoogleSolarInsight;
    retrievedAt: string;
  }) {
    const success = input.insight.status === "success" ? input.insight : null;
    const { data, error } = await this.client
      .from("roof_insights")
      .upsert(
        {
          company_id: input.companyId,
          property_id: input.event.propertyId,
          provider: "google_solar",
          normalized_address: input.normalizedAddress,
          lookup_status: input.insight.status,
          building_name: success?.buildingName ?? null,
          latitude: success?.latitude ?? input.event.latitude,
          longitude: success?.longitude ?? input.event.longitude,
          imagery_date: success?.imageryDate ?? null,
          imagery_quality: success?.imageryQuality ?? null,
          roof_segments: (success?.roofSegments ?? []) as unknown as Json,
          plane_count: success?.roofSegments.length ?? null,
          total_roof_sqft: success?.totalRoofSqft ?? null,
          raw_response: input.insight.rawResponse as Json | null,
          source_retrieved_at: input.retrievedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,provider,normalized_address" },
      )
      .select("id")
      .single();
    if (error || !data) throw new Error("Failed to persist Google roof insight");
    return { id: data.id, insight: input.insight, retrievedAt: input.retrievedAt };
  }

  async completeProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
    insight: GoogleSolarInsight;
    retrievedAt: string;
    sourceIdentifier: string;
  }) {
    const { error } = await this.client
      .from("provider_requests")
      .update({ status: "succeeded", completed_at: input.retrievedAt })
      .eq("id", input.providerRequestId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to complete Solar provider request");
    const { error: costError } = await this.client.from("provider_cost_entries").upsert(
      {
        provider_request_id: input.providerRequestId,
        estimated_cost_micros: 10_000,
        actual_cost_micros: 0,
      },
      { onConflict: "provider_request_id" },
    );
    if (costError) throw new Error("Failed to record Solar provider cost");
    const { error: sourceError } = await this.client.from("source_records").upsert(
      {
        company_id: input.companyId,
        provider: "google_solar",
        source_identifier: `${input.companyId}:${input.sourceIdentifier}`,
        retrieved_at: input.retrievedAt,
        raw_payload: input.insight.rawResponse as Json | null,
      },
      { onConflict: "provider,source_identifier,retrieved_at", ignoreDuplicates: true },
    );
    if (sourceError) throw new Error("Failed to record Solar source evidence");
  }

  async blockProviderRequest(input: { providerRequestId: string; companyId: string }) {
    const { error } = await this.client
      .from("provider_requests")
      .update({ status: "blocked_budget", completed_at: new Date().toISOString() })
      .eq("id", input.providerRequestId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to record blocked Solar request");
  }

  async failProviderRequest(input: { providerRequestId: string; companyId: string }) {
    const { error } = await this.client
      .from("provider_requests")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", input.providerRequestId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to record failed Solar request");
  }

  async finalizeEstimate(input: {
    estimateId: string;
    companyId: string;
    insightRecord: RoofInsightRecord | null;
    status: "ready" | "no_coverage" | "quota_exhausted" | "failed";
    failureReason?: string;
  }) {
    const success = input.insightRecord?.insight.status === "success"
      ? input.insightRecord.insight
      : null;
    const estimate = success
      ? calculatePreliminaryRoofEstimate(success.totalRoofSqft)
      : null;
    const { error } = await this.client
      .from("roof_estimates")
      .update({
        roof_insight_id: input.insightRecord?.id ?? null,
        status: input.status,
        total_roof_sqft: success?.totalRoofSqft ?? null,
        roof_squares: estimate?.roofSquares ?? null,
        price_per_square_low_cents: estimate?.pricePerSquareLowCents ?? 50_000,
        price_per_square_high_cents: estimate?.pricePerSquareHighCents ?? 75_000,
        range_low_cents: estimate?.rangeLowCents ?? null,
        range_high_cents: estimate?.rangeHighCents ?? null,
        pricing_version: estimate?.pricingVersion ?? "nj-asphalt-v1",
        assumptions: {
          material: "architectural asphalt shingles",
          market: "New Jersey average",
          excludes: ["decking replacement", "permit variance", "site-specific complexity"],
          preliminary: true,
        },
        failure_reason: input.failureReason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.estimateId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to finalize roof estimate");
  }

  async queueDeliveries(input: {
    estimateId: string;
    companyId: string;
    leadId: string;
    name: string;
    phone: string;
    email: string;
    status: "ready" | "no_coverage" | "quota_exhausted" | "failed";
    estimate?: ReturnType<typeof calculatePreliminaryRoofEstimate>;
  }) {
    const ready = input.status === "ready" && input.estimate;
    const money = (cents: number) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
    const body = ready
      ? `Hi ${input.name}, your preliminary New Jersey roof replacement range is ${money(input.estimate!.rangeLowCents)}–${money(input.estimate!.rangeHighCents)}. This is an early estimate, not a final quote. Includes data from Google Maps. Reply or book an inspection for a confirmed proposal.`
      : `Hi ${input.name}, we received your roof estimate request. We could not produce a reliable instant range, so our team will review the property and follow up.`;
    const rows = [
      {
        company_id: input.companyId,
        estimate_id: input.estimateId,
        lead_id: input.leadId,
        channel: "sms",
        destination: input.phone,
        composed_subject: null,
        composed_body: body,
      },
      {
        company_id: input.companyId,
        estimate_id: input.estimateId,
        lead_id: input.leadId,
        channel: "email",
        destination: input.email,
        composed_subject: ready ? "Your preliminary roof estimate" : "We received your roof estimate request",
        composed_body: body,
      },
    ];
    const { error } = await this.client
      .from("estimate_deliveries")
      .upsert(rows, { onConflict: "estimate_id,channel", ignoreDuplicates: true });
    if (error) throw new Error("Failed to queue estimate deliveries");
  }

  async queueContextDialer(input: {
    estimateId: string;
    companyId: string;
    leadId: string;
    pipelineRunId: string;
  }) {
    const { error } = await this.client
      .from("context_dialer_deliveries")
      .upsert(
        {
          company_id: input.companyId,
          pipeline_run_id: input.pipelineRunId,
          lead_id: input.leadId,
          estimate_id: input.estimateId,
        },
        { onConflict: "pipeline_run_id", ignoreDuplicates: true },
      );
    if (error) throw new Error("Failed to queue Context Dialer handoff");
  }

  async completePipeline(input: {
    pipelineRunId: string;
    propertyId: string;
    companyId: string;
  }) {
    const results = await Promise.all([
      this.client
        .from("pipeline_runs")
        .update({ status: "complete", finished_at: new Date().toISOString() })
        .eq("id", input.pipelineRunId)
        .eq("company_id", input.companyId),
      this.client
        .from("properties")
        .update({ resolution_status: "resolved", updated_at: new Date().toISOString() })
        .eq("id", input.propertyId)
        .eq("company_id", input.companyId),
    ]);
    if (results.some(({ error }) => error)) {
      throw new Error("Failed to complete roof-estimate pipeline");
    }
  }

  async markWorkerRunCompleted(workerRunId: string) {
    const { error } = await this.client
      .from("worker_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", workerRunId)
      .neq("status", "completed");
    if (error) throw new Error("Failed to complete roof-estimate worker");
  }
}

export const roofEstimateWorker = inngest.createFunction(
  { id: "roof-estimate-worker", triggers: { event: propertyDiscoveryRequested } },
  async ({ event }) => {
    const startedAt = Date.now();
    let input: RoofEstimateEvent | undefined;
    console.log(JSON.stringify({
      level: "info",
      message: "Roof estimate event received",
      eventId: event.id,
      dataKeys:
        event.data && typeof event.data === "object"
          ? Object.keys(event.data).sort()
          : [],
    }));
    try {
      input = await resolveRoofEstimateEvent(event.id, event.data);
      console.log(JSON.stringify({
        level: "info",
        message: "Roof estimate worker started",
        pipelineRunId: input?.pipelineRunId,
        correlationId: input?.correlationId,
      }));
      const result = await runRoofEstimate(
        input,
        new SupabaseRoofEstimateWorkerRepository(),
      );
      console.log(JSON.stringify({
        level: "info",
        message: "Roof estimate worker completed",
        pipelineRunId: input.pipelineRunId,
        outcome: result.outcome,
        durationMs: Date.now() - startedAt,
      }));
      return result;
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Roof estimate worker failed",
        pipelineRunId: input?.pipelineRunId,
        correlationId: input?.correlationId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      }));
      throw error;
    }
  },
);

async function resolveRoofEstimateEvent(
  inngestEventId: string,
  raw: unknown,
): Promise<RoofEstimateEvent> {
  if (
    raw &&
    typeof raw === "object" &&
    "pipelineRunId" in raw &&
    "correlationId" in raw &&
    "data" in raw
  ) {
    const envelope = raw as {
      id: string;
      pipelineRunId: string;
      correlationId: string;
      leadId: string;
      propertyId: string;
      data: unknown;
    };
    const data = propertyDiscoveryRequestedDataSchema.parse(envelope.data);
    return {
      id: envelope.id,
      pipelineRunId: envelope.pipelineRunId,
      correlationId: envelope.correlationId,
      leadId: envelope.leadId,
      propertyId: envelope.propertyId,
      canonicalAddress: data.canonicalAddress,
      latitude: data.latitude,
      longitude: data.longitude,
      attempt: data.attempt,
    };
  }

  const data = propertyDiscoveryRequestedDataSchema.parse(raw);
  const client = createServiceClient();
  const { data: run, error } = await client
    .from("pipeline_runs")
    .select("id, correlation_id, property_id")
    .eq("lead_id", data.leadId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !run?.property_id) {
    throw new Error("Unable to reconstruct roof-estimate pipeline scope");
  }
  return {
    id: inngestEventId,
    pipelineRunId: run.id,
    correlationId: run.correlation_id,
    leadId: data.leadId,
    propertyId: run.property_id,
    canonicalAddress: data.canonicalAddress,
    latitude: data.latitude,
    longitude: data.longitude,
    attempt: data.attempt,
  };
}
