import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  parcelDataSchema,
  type ParcelData,
} from "@/domain/property-identity";
import {
  inngest,
  propertyDiscoveryRequested,
} from "@/inngest/client";
import type { Database, Json } from "@/lib/database.types";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  decideParcelResolution,
  type ParcelResolutionDecision,
} from "@/modules/property-identity/decide-parcel-resolution";
import type {
  ProviderAdapter,
  ProviderResult,
} from "@/modules/providers/contracts";
import { createPropertyIdentityProviderRegistry } from "@/modules/providers/property-identity-registry";

const SCOPE_ERROR = "Property-discovery scope mismatch";

export type WorkerRunRecord = { id: string; status: string };
type ParcelEvidence = ProviderResult<ParcelData[]>;
type ParcelReviewReason =
  | "multiple_parcels"
  | "condo_ambiguity"
  | "commercial_property"
  | "unsupported_property_type";

const parcelEvidenceSchema = z.object({
  value: z.array(parcelDataSchema),
  provider: z.string().min(1),
  sourceIdentifier: z.string().min(1),
  retrievedAt: z.iso.datetime(),
  estimatedCostMicros: z.number().int().nonnegative(),
  actualCostMicros: z.number().int().nonnegative().optional(),
  rawArtifactId: z.string().min(1).optional(),
});

const propertyDiscoveryAttemptSchema = z.object({
  evidence: parcelEvidenceSchema,
  decision: z.discriminatedUnion("outcome", [
    z.object({
      outcome: z.literal("resolved"),
      parcel: parcelDataSchema,
    }),
    z.object({
      outcome: z.literal("review"),
      reason: z.enum([
        "multiple_parcels",
        "condo_ambiguity",
        "commercial_property",
        "unsupported_property_type",
      ]),
    }),
  ]),
});

export type PropertyDiscoveryAttempt = {
  evidence: ParcelEvidence;
  decision: ParcelResolutionDecision;
};

export interface PropertyDiscoveryWorkerRepository {
  assertEventScope(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
  }): Promise<{ companyId: string }>;
  upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  startEnriching(input: {
    pipelineRunId: string;
    companyId: string;
  }): Promise<void>;
  lookupParcels(input: {
    latitude: number | null;
    longitude: number | null;
    canonicalAddress: string;
    pipelineRunId: string;
    correlationId: string;
    companyId: string;
  }): Promise<ParcelEvidence>;
  loadWorkerAttempt(
    workerRunId: string,
  ): Promise<PropertyDiscoveryAttempt | null>;
  persistWorkerAttempt(input: {
    workerRunId: string;
    attempt: PropertyDiscoveryAttempt;
  }): Promise<PropertyDiscoveryAttempt>;
  recordProviderEvidence(input: {
    pipelineRunId: string;
    companyId: string;
    evidence: ParcelEvidence;
  }): Promise<{ providerRequestId?: string }>;
  recordParcel(input: {
    propertyId: string;
    companyId: string;
    parcel: ParcelData;
    providerRequestId?: string;
  }): Promise<{ parcelId: string }>;
  recordStructure(input: {
    propertyId: string;
    parcelId: string;
    companyId: string;
  }): Promise<void>;
  resolveProperty(input: {
    propertyId: string;
    companyId: string;
  }): Promise<void>;
  createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    companyId: string;
    reason: ParcelReviewReason;
    candidateData: unknown;
  }): Promise<void>;
  completePipelineRun(input: {
    pipelineRunId: string;
    companyId: string;
  }): Promise<void>;
  writeAudit(input: {
    action: string;
    propertyId: string;
    companyId: string;
    correlationId: string;
    workerRunId: string;
  }): Promise<void>;
}

type PropertyDiscoveryEventData = {
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

export async function runPropertyDiscovery(
  event: PropertyDiscoveryEventData,
  repository: PropertyDiscoveryWorkerRepository,
) {
  const { companyId } = await repository.assertEventScope({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  });
  const idempotencyKey = `property-discovery-worker:${event.pipelineRunId}:${event.attempt}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  if (workerRun.status === "completed") {
    return { workerRunId: workerRun.id, outcome: "already_completed" as const };
  }

  await repository.startEnriching({
    pipelineRunId: event.pipelineRunId,
    companyId,
  });

  let attempt = await repository.loadWorkerAttempt(workerRun.id);
  if (attempt === null) {
    const evidence = await repository.lookupParcels({
      latitude: event.latitude,
      longitude: event.longitude,
      canonicalAddress: event.canonicalAddress,
      pipelineRunId: event.pipelineRunId,
      correlationId: event.correlationId,
      companyId,
    });
    attempt = await repository.persistWorkerAttempt({
      workerRunId: workerRun.id,
      attempt: {
        evidence,
        decision: decideParcelResolution(evidence.value),
      },
    });
  }

  const { providerRequestId } = await repository.recordProviderEvidence({
    pipelineRunId: event.pipelineRunId,
    companyId,
    evidence: attempt.evidence,
  });

  const decision = attempt.decision;
  let outcome: "resolved" | "review_required";

  if (decision.outcome === "review") {
    await repository.createReviewTask({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
      companyId,
      reason: decision.reason,
      candidateData: { candidates: attempt.evidence.value },
    });
    outcome = "review_required";
  } else {
    const { parcelId } = await repository.recordParcel({
      propertyId: event.propertyId,
      companyId,
      parcel: decision.parcel,
      providerRequestId,
    });
    await repository.recordStructure({
      propertyId: event.propertyId,
      parcelId,
      companyId,
    });
    await repository.resolveProperty({
      propertyId: event.propertyId,
      companyId,
    });
    await repository.completePipelineRun({
      pipelineRunId: event.pipelineRunId,
      companyId,
    });
    outcome = "resolved";
  }

  await repository.writeAudit({
    action:
      outcome === "resolved"
        ? "property.discovery_resolved"
        : "property.discovery_review_required",
    propertyId: event.propertyId,
    companyId,
    correlationId: event.correlationId,
    workerRunId: workerRun.id,
  });
  await repository.markWorkerRunCompleted(workerRun.id);

  return { workerRunId: workerRun.id, outcome };
}

function dollarsToCents(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

function polygonCoordinatesToWkt(rawCoordinates: unknown): string {
  if (!Array.isArray(rawCoordinates)) {
    throw new Error("Invalid parcel polygon geometry");
  }

  const rings = rawCoordinates.map((rawRing) => {
    if (!Array.isArray(rawRing)) {
      throw new Error("Invalid parcel polygon geometry");
    }
    const positions = rawRing.map((rawPosition) => {
      if (
        !Array.isArray(rawPosition) ||
        rawPosition.length < 2 ||
        typeof rawPosition[0] !== "number" ||
        typeof rawPosition[1] !== "number"
      ) {
        throw new Error("Invalid parcel polygon geometry");
      }
      return `${rawPosition[0]} ${rawPosition[1]}`;
    });
    return `(${positions.join(",")})`;
  });

  return `(${rings.join(",")})`;
}

function parcelGeoJsonToEwkt(
  geometry: Record<string, unknown> | null,
): string | null {
  if (geometry === null) return null;

  if (geometry.type === "Polygon") {
    return `SRID=4326;POLYGON${polygonCoordinatesToWkt(
      geometry.coordinates,
    )}`;
  }

  if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates)) {
      throw new Error("Invalid parcel polygon geometry");
    }
    const polygons = geometry.coordinates.map(polygonCoordinatesToWkt);
    return `SRID=4326;MULTIPOLYGON(${polygons.join(",")})`;
  }

  throw new Error("Invalid parcel polygon geometry");
}

type PropertyIdentityProviderRegistry = ReturnType<
  typeof createPropertyIdentityProviderRegistry
>;

export class SupabasePropertyDiscoveryWorkerRepository
  implements PropertyDiscoveryWorkerRepository
{
  constructor(
    private readonly client: SupabaseClient<Database> = createServiceClient(),
    private readonly providerRegistry: PropertyIdentityProviderRegistry =
      createPropertyIdentityProviderRegistry(),
  ) {}

  async assertEventScope(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
  }) {
    const { data: pipelineRun, error: pipelineError } = await this.client
      .from("pipeline_runs")
      .select("company_id, lead_id, property_id")
      .eq("id", input.pipelineRunId)
      .single();
    const { data: lead, error: leadError } = await this.client
      .from("leads")
      .select("company_id, property_id")
      .eq("id", input.leadId)
      .single();
    const { data: property, error: propertyError } = await this.client
      .from("properties")
      .select("company_id, merged_into_property_id")
      .eq("id", input.propertyId)
      .single();

    if (
      pipelineError ||
      leadError ||
      propertyError ||
      !pipelineRun ||
      !lead ||
      !property ||
      property.merged_into_property_id !== null ||
      pipelineRun.lead_id !== input.leadId ||
      pipelineRun.property_id !== input.propertyId ||
      lead.property_id !== input.propertyId ||
      pipelineRun.company_id !== lead.company_id ||
      pipelineRun.company_id !== property.company_id
    ) {
      throw new Error(SCOPE_ERROR);
    }

    return { companyId: pipelineRun.company_id };
  }

  async upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }) {
    const { data: inserted, error: insertError } = await this.client
      .from("worker_runs")
      .insert({
        pipeline_run_id: input.pipelineRunId,
        worker_type: "property_discovery",
        worker_version: 1,
        idempotency_key: input.idempotencyKey,
        status: "queued",
        started_at: new Date().toISOString(),
      })
      .select("id, status")
      .single();

    if (!insertError && inserted) return inserted;

    const { data: existing, error: selectError } = await this.client
      .from("worker_runs")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    if (selectError || !existing) {
      throw new Error("Failed to record property-discovery worker start");
    }
    return existing;
  }

  async markWorkerRunCompleted(workerRunId: string) {
    const { error } = await this.client
      .from("worker_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", workerRunId)
      .neq("status", "completed");
    if (error) throw new Error("Failed to complete property-discovery worker");
  }

  async startEnriching(input: {
    pipelineRunId: string;
    companyId: string;
  }) {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({ status: "enriching" })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId)
      .eq("status", "validating");
    if (error) throw new Error("Failed to start property discovery");
  }

  async lookupParcels(input: {
    latitude: number | null;
    longitude: number | null;
    canonicalAddress: string;
    pipelineRunId: string;
    correlationId: string;
    companyId: string;
  }) {
    const provider = this.providerRegistry.resolve(
      "parcel.lookup",
    ) as ProviderAdapter<
      { lat: number; lng: number } | { address: string },
      ParcelData[]
    >;
    const providerInput =
      input.latitude !== null && input.longitude !== null
        ? { lat: input.latitude, lng: input.longitude }
        : { address: input.canonicalAddress };
    const environment = parseServerEnv(process.env);

    return provider.execute(providerInput, {
      companyId: input.companyId,
      pipelineRunId: input.pipelineRunId,
      correlationId: input.correlationId,
      requestKey: `parcel.lookup:${input.pipelineRunId}`,
      deploymentEnvironment: environment.DEPLOYMENT_ENV,
    });
  }

  async loadWorkerAttempt(workerRunId: string) {
    const { data, error } = await this.client
      .from("worker_runs")
      .select("output")
      .eq("id", workerRunId)
      .single();
    if (error || !data) {
      throw new Error("Failed to load property-discovery attempt");
    }
    if (data.output === null) return null;

    const parsed = propertyDiscoveryAttemptSchema.safeParse(data.output);
    if (!parsed.success) {
      throw new Error("Stored property-discovery attempt is invalid");
    }
    return parsed.data;
  }

  async persistWorkerAttempt(input: {
    workerRunId: string;
    attempt: PropertyDiscoveryAttempt;
  }) {
    const validatedAttempt = propertyDiscoveryAttemptSchema.parse(input.attempt);
    const { data: updated, error } = await this.client
      .from("worker_runs")
      .update({ output: validatedAttempt as unknown as Json })
      .eq("id", input.workerRunId)
      .is("output", null)
      .select("output")
      .maybeSingle();
    if (error) {
      throw new Error("Failed to persist property-discovery attempt");
    }

    if (updated?.output) {
      return propertyDiscoveryAttemptSchema.parse(updated.output);
    }

    const existing = await this.loadWorkerAttempt(input.workerRunId);
    if (existing === null) {
      throw new Error("Failed to load persisted property-discovery attempt");
    }
    return existing;
  }

  async recordProviderEvidence(input: {
    pipelineRunId: string;
    companyId: string;
    evidence: ParcelEvidence;
  }) {
    const requestKey = `parcel.lookup:${input.pipelineRunId}`;
    const { data: inserted, error: insertError } = await this.client
      .from("provider_requests")
      .insert({
        company_id: input.companyId,
        pipeline_run_id: input.pipelineRunId,
        capability: "parcel.lookup",
        provider: input.evidence.provider,
        request_key: requestKey,
        status: "succeeded",
        requested_at: input.evidence.retrievedAt,
        completed_at: input.evidence.retrievedAt,
      })
      .select("id, requested_at, completed_at")
      .single();

    if (insertError && insertError.code !== "23505") {
      throw new Error("Failed to record parcel-lookup provider request");
    }

    let providerRequest = inserted;
    if (!providerRequest) {
      const { data: existing, error: selectError } = await this.client
        .from("provider_requests")
        .select("id, requested_at, completed_at")
        .eq("request_key", requestKey)
        .eq("company_id", input.companyId)
        .single();
      if (selectError || !existing) {
        throw new Error("Failed to load parcel-lookup provider request");
      }
      providerRequest = existing;
    }

    const { error: sourceError } = await this.client.from("source_records").upsert(
      {
        company_id: input.companyId,
        provider: input.evidence.provider,
        source_identifier: `${input.companyId}:${input.evidence.sourceIdentifier}`,
        retrieved_at:
          providerRequest.completed_at ?? providerRequest.requested_at,
        raw_payload: input.evidence.value as unknown as Json,
      },
      {
        onConflict: "provider,source_identifier,retrieved_at",
        ignoreDuplicates: true,
      },
    );
    if (sourceError) throw new Error("Failed to record parcel-lookup source");

    return { providerRequestId: providerRequest.id };
  }

  async recordParcel(input: {
    propertyId: string;
    companyId: string;
    parcel: ParcelData;
    providerRequestId?: string;
  }) {
    const { data: inserted, error: insertError } = await this.client
      .from("parcels")
      .insert({
        company_id: input.companyId,
        property_id: input.propertyId,
        is_primary: true,
        block: input.parcel.block,
        lot: input.parcel.lot,
        qualifier: input.parcel.qualifier,
        pams_pin: input.parcel.pamsPin,
        gis_pin: input.parcel.gisPin,
        municipality_code: input.parcel.municipalityCode,
        municipality_name: input.parcel.municipalityName,
        county: input.parcel.county,
        property_class: input.parcel.propertyClass,
        acreage: input.parcel.acreage,
        year_built: input.parcel.yearBuilt,
        land_value_cents: dollarsToCents(input.parcel.landValue),
        improvement_value_cents: dollarsToCents(
          input.parcel.improvementValue,
        ),
        net_value_cents: dollarsToCents(input.parcel.netValue),
        property_location: input.parcel.propertyLocation,
        street_address: input.parcel.streetAddress,
        building_description: input.parcel.buildingDescription,
        land_description: input.parcel.landDescription,
        dwelling_units: input.parcel.dwellingUnits,
        geometry: parcelGeoJsonToEwkt(input.parcel.geometry),
        provider_request_id: input.providerRequestId,
      })
      .select("id")
      .single();

    if (!insertError && inserted) return { parcelId: inserted.id };
    if (insertError?.code !== "23505") {
      throw new Error("Failed to record primary parcel");
    }

    const { data: existing, error: selectError } = await this.client
      .from("parcels")
      .select("id")
      .eq("property_id", input.propertyId)
      .eq("company_id", input.companyId)
      .eq("is_primary", true)
      .single();
    if (selectError || !existing) {
      throw new Error("Failed to load existing primary parcel");
    }
    return { parcelId: existing.id };
  }

  async recordStructure(input: {
    propertyId: string;
    parcelId: string;
    companyId: string;
  }) {
    const { error } = await this.client.from("structures").insert({
      company_id: input.companyId,
      property_id: input.propertyId,
      parcel_id: input.parcelId,
      is_primary: true,
      source: "njgin_parcels_composite",
    });
    if (!error || error.code === "23505") return;
    throw new Error("Failed to record primary structure");
  }

  async resolveProperty(input: {
    propertyId: string;
    companyId: string;
  }) {
    const { error } = await this.client
      .from("properties")
      .update({
        resolution_status: "resolved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.propertyId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to resolve property");
  }

  async createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    companyId: string;
    reason: ParcelReviewReason;
    candidateData: unknown;
  }) {
    const scope = await this.assertEventScope(input);
    if (scope.companyId !== input.companyId) throw new Error(SCOPE_ERROR);

    const { error: reviewError } = await this.client.from("review_tasks").insert({
      company_id: input.companyId,
      pipeline_run_id: input.pipelineRunId,
      lead_id: input.leadId,
      property_id: input.propertyId,
      reason: input.reason,
      triggering_event_name: "property/discovery_requested",
      candidate_data: input.candidateData as Json,
    });
    if (reviewError && reviewError.code !== "23505") {
      throw new Error("Failed to create property-discovery review task");
    }

    const { error: propertyError } = await this.client
      .from("properties")
      .update({ resolution_status: "review_required" })
      .eq("id", input.propertyId)
      .eq("company_id", input.companyId);
    if (propertyError) throw new Error("Failed to mark property for review");

    const { error: runError } = await this.client
      .from("pipeline_runs")
      .update({ status: "review_required" })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId);
    if (runError) throw new Error("Failed to mark pipeline for review");
  }

  async completePipelineRun(input: {
    pipelineRunId: string;
    companyId: string;
  }) {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({
        status: "complete",
        finished_at: new Date().toISOString(),
      })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId)
      .neq("status", "complete");
    if (error) throw new Error("Failed to complete property pipeline");
  }

  async writeAudit(input: {
    action: string;
    propertyId: string;
    companyId: string;
    correlationId: string;
    workerRunId: string;
  }) {
    const { data: property, error } = await this.client
      .from("properties")
      .select("company_id")
      .eq("id", input.propertyId)
      .eq("company_id", input.companyId)
      .single();
    if (error || !property) throw new Error(SCOPE_ERROR);

    const { error: auditError } = await this.client.from("audit_log").insert({
      company_id: input.companyId,
      action: input.action,
      entity_type: "property",
      entity_id: input.propertyId,
      correlation_id: input.correlationId,
      worker_run_id: input.workerRunId,
    });
    if (auditError && auditError.code !== "23505") {
      throw new Error("Failed to write property-discovery audit entry");
    }
  }
}

export const propertyDiscoveryWorker = inngest.createFunction(
  {
    id: "property-discovery-worker",
    triggers: { event: propertyDiscoveryRequested },
  },
  async ({ event }) => {
    const envelope = event.data;
    return runPropertyDiscovery(
      {
        id: envelope.id,
        pipelineRunId: envelope.pipelineRunId,
        correlationId: envelope.correlationId,
        leadId: envelope.data.leadId,
        propertyId: envelope.data.propertyId,
        canonicalAddress: envelope.data.canonicalAddress,
        latitude: envelope.data.latitude,
        longitude: envelope.data.longitude,
        attempt: envelope.data.attempt,
      },
      new SupabasePropertyDiscoveryWorkerRepository(),
    );
  },
);
