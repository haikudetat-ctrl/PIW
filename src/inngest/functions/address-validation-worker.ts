import "server-only";
import type { AddressValidationResult } from "@/domain/property-identity";
import { createEventEnvelope } from "@/domain/events";
import { addressValidationRequested, inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import type { Json } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { decideDuplicateMatch } from "@/modules/property-identity/decide-duplicate-match";
import { normalizeAddressForMatching } from "@/modules/property-identity/normalize-address";
import type {
  ProviderAdapter,
  ProviderResult,
} from "@/modules/providers/contracts";
import { createPropertyIdentityProviderRegistry } from "@/modules/providers/property-identity-registry";

const CONFIDENCE_REVIEW_THRESHOLD = 95;
const DUPLICATE_WINDOW_DAYS = 180;

export type WorkerRunRecord = { id: string; status: string };

type AddressValidationEvidence = ProviderResult<AddressValidationResult>;

export interface AddressValidationWorkerRepository {
  upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  startValidating(pipelineRunId: string): Promise<void>;
  validateAddress(input: {
    submittedAddress: string;
    pipelineRunId: string;
    correlationId: string;
  }): Promise<AddressValidationEvidence>;
  recordProviderEvidence(input: {
    pipelineRunId: string;
    evidence: AddressValidationEvidence;
  }): Promise<{ providerRequestId?: string }>;
  recordPropertyAddress(input: {
    propertyId: string;
    workerRunId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    providerRequestId?: string;
  }): Promise<boolean>;
  updateCanonicalPropertyFields(input: {
    propertyId: string;
    result: AddressValidationResult;
  }): Promise<void>;
  findDuplicateCandidates(input: {
    excludePropertyId: string;
    normalizedAddress: string;
    windowStartIso: string;
  }): Promise<{ propertyId: string }[]>;
  mergeIntoCanonicalProperty(input: {
    placeholderPropertyId: string;
    canonicalPropertyId: string;
    leadId: string;
    pipelineRunId: string;
  }): Promise<void>;
  createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    reason: "low_address_confidence" | "duplicate_candidates";
    candidateData: unknown;
  }): Promise<void>;
  publishDiscoveryRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    canonicalAddress: string;
    latitude: number | null;
    longitude: number | null;
    attempt: number;
  }): Promise<void>;
  writeAudit(input: {
    action: string;
    propertyId: string;
    correlationId: string;
  }): Promise<void>;
}

type AddressValidationEventData = {
  id: string;
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
  propertyId: string;
  submittedAddress: string;
  attempt: number;
};

export async function runAddressValidation(
  event: AddressValidationEventData,
  repository: AddressValidationWorkerRepository,
) {
  const idempotencyKey = `address-validation-worker:${event.pipelineRunId}:${event.attempt}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  if (workerRun.status === "completed") {
    return { workerRunId: workerRun.id, outcome: "already_completed" as const };
  }

  await repository.startValidating(event.pipelineRunId);

  const evidence = await repository.validateAddress({
    submittedAddress: event.submittedAddress,
    pipelineRunId: event.pipelineRunId,
    correlationId: event.correlationId,
  });
  const result = evidence.value;
  const { providerRequestId } = await repository.recordProviderEvidence({
    pipelineRunId: event.pipelineRunId,
    evidence,
  });

  let outcome: "review_required" | "merged" | "discovery_requested";
  let observationPropertyId = event.propertyId;
  let duplicateDecision:
    | ReturnType<typeof decideDuplicateMatch>
    | undefined;

  if (result.confidence >= CONFIDENCE_REVIEW_THRESHOLD) {
    const windowStartIso = new Date(
      Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const candidates = await repository.findDuplicateCandidates({
      excludePropertyId: event.propertyId,
      normalizedAddress: normalizeAddressForMatching(
        result.canonicalAddress ?? event.submittedAddress,
      ),
      windowStartIso,
    });
    duplicateDecision = decideDuplicateMatch(candidates);
    if (duplicateDecision.outcome === "merge") {
      observationPropertyId = duplicateDecision.canonicalPropertyId;
    }
  }

  const recorded = await repository.recordPropertyAddress({
    propertyId: observationPropertyId,
    workerRunId: workerRun.id,
    submittedAddress: event.submittedAddress,
    result,
    providerRequestId,
  });
  if (!recorded) {
    return { workerRunId: workerRun.id, outcome: "already_processed" as const };
  }

  if (result.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    await repository.createReviewTask({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
      reason: "low_address_confidence",
      candidateData: { result },
    });
    outcome = "review_required";
  } else {
    await repository.updateCanonicalPropertyFields({
      propertyId: observationPropertyId,
      result,
    });

    if (duplicateDecision?.outcome === "ambiguous") {
      await repository.createReviewTask({
        pipelineRunId: event.pipelineRunId,
        leadId: event.leadId,
        propertyId: event.propertyId,
        reason: "duplicate_candidates",
        candidateData: {
          candidatePropertyIds: duplicateDecision.candidatePropertyIds,
        },
      });
      outcome = "review_required";
    } else if (duplicateDecision?.outcome === "merge") {
      await repository.mergeIntoCanonicalProperty({
        placeholderPropertyId: event.propertyId,
        canonicalPropertyId: duplicateDecision.canonicalPropertyId,
        leadId: event.leadId,
        pipelineRunId: event.pipelineRunId,
      });
      outcome = "merged";
    } else {
      await repository.publishDiscoveryRequested({
        leadId: event.leadId,
        propertyId: event.propertyId,
        pipelineRunId: event.pipelineRunId,
        correlationId: event.correlationId,
        canonicalAddress: result.canonicalAddress ?? event.submittedAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        attempt: 1,
      });
      outcome = "discovery_requested";
    }
  }

  await repository.markWorkerRunCompleted(workerRun.id);
  await repository.writeAudit({
    action:
      outcome === "review_required"
        ? "property.address_validation_review_required"
        : "property.address_validated",
    propertyId: observationPropertyId,
    correlationId: event.correlationId,
  });

  return { workerRunId: workerRun.id, outcome };
}

export class SupabaseAddressValidationWorkerRepository
  implements AddressValidationWorkerRepository
{
  private readonly client = createServiceClient();

  async upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }) {
    const { data: inserted, error: insertError } = await this.client
      .from("worker_runs")
      .insert({
        pipeline_run_id: input.pipelineRunId,
        worker_type: "address_validation",
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
      throw new Error("Failed to record address-validation worker start");
    }
    return existing;
  }

  async markWorkerRunCompleted(workerRunId: string) {
    const { error } = await this.client
      .from("worker_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", workerRunId)
      .neq("status", "completed");
    if (error) throw new Error("Failed to complete address-validation worker");
  }

  async startValidating(pipelineRunId: string) {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({ status: "validating" })
      .eq("id", pipelineRunId)
      .eq("status", "received");
    if (error) throw new Error("Failed to start address validation");
  }

  async validateAddress(input: {
    submittedAddress: string;
    pipelineRunId: string;
    correlationId: string;
  }) {
    const { data: pipelineRun, error } = await this.client
      .from("pipeline_runs")
      .select("company_id")
      .eq("id", input.pipelineRunId)
      .single();
    if (error || !pipelineRun) {
      throw new Error("Failed to load pipeline run for address validation");
    }

    const environment = parseServerEnv(process.env);
    const provider = createPropertyIdentityProviderRegistry().resolve(
      "address.validate",
    ) as ProviderAdapter<{ submittedAddress: string }, AddressValidationResult>;
    return provider.execute(
        { submittedAddress: input.submittedAddress },
        {
          companyId: pipelineRun.company_id,
          pipelineRunId: input.pipelineRunId,
          correlationId: input.correlationId,
          requestKey: `address.validate:${input.pipelineRunId}`,
          deploymentEnvironment: environment.DEPLOYMENT_ENV,
        },
      );
  }

  async recordProviderEvidence(input: {
    pipelineRunId: string;
    evidence: AddressValidationEvidence;
  }) {
    const { data: pipelineRun, error: pipelineError } = await this.client
      .from("pipeline_runs")
      .select("company_id")
      .eq("id", input.pipelineRunId)
      .single();
    if (pipelineError || !pipelineRun) {
      throw new Error("Failed to load pipeline run for provider evidence");
    }

    const requestKey = `address.validate:${input.pipelineRunId}`;
    const { data: inserted, error: insertError } = await this.client
      .from("provider_requests")
      .insert({
        company_id: pipelineRun.company_id,
        pipeline_run_id: input.pipelineRunId,
        capability: "address.validate",
        provider: input.evidence.provider,
        request_key: requestKey,
        status: "succeeded",
        completed_at: input.evidence.retrievedAt,
      })
      .select("id")
      .single();

    if (!insertError && inserted) {
      const { error: sourceError } = await this.client.from("source_records").insert({
        company_id: pipelineRun.company_id,
        provider: input.evidence.provider,
        source_identifier: input.evidence.sourceIdentifier,
        retrieved_at: input.evidence.retrievedAt,
        raw_payload: input.evidence.value as unknown as Json,
      });
      if (sourceError && sourceError.code !== "23505") {
        throw new Error("Failed to record address-validation source");
      }
      return { providerRequestId: inserted.id };
    }

    if (insertError?.code !== "23505") {
      throw new Error("Failed to record address-validation provider request");
    }

    const { data: existing, error: selectError } = await this.client
      .from("provider_requests")
      .select("id")
      .eq("request_key", requestKey)
      .single();
    if (selectError || !existing) {
      throw new Error("Failed to load address-validation provider request");
    }
    return { providerRequestId: existing.id };
  }

  async recordPropertyAddress(input: {
    propertyId: string;
    workerRunId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    providerRequestId?: string;
  }) {
    const { data: property, error: propertyError } = await this.client
      .from("properties")
      .select("company_id")
      .eq("id", input.propertyId)
      .single();
    if (propertyError || !property) {
      throw new Error("Failed to load property for address observation");
    }

    const location =
      input.result.longitude === null || input.result.latitude === null
        ? null
        : `SRID=4326;POINT(${input.result.longitude} ${input.result.latitude})`;
    const { error } = await this.client.from("property_addresses").insert({
      company_id: property.company_id,
      property_id: input.propertyId,
      worker_run_id: input.workerRunId,
      submitted_address: input.submittedAddress,
      canonical_address: input.result.canonicalAddress,
      latitude: input.result.latitude,
      longitude: input.result.longitude,
      location,
      municipality: input.result.municipality,
      county: input.result.county,
      state_code: input.result.stateCode,
      zip: input.result.zip,
      match_method: input.result.matchMethod,
      confidence: input.result.confidence,
      provider_request_id: input.providerRequestId,
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error("Failed to record property address");
  }

  async updateCanonicalPropertyFields(input: {
    propertyId: string;
    result: AddressValidationResult;
  }) {
    const location =
      input.result.longitude === null || input.result.latitude === null
        ? null
        : `SRID=4326;POINT(${input.result.longitude} ${input.result.latitude})`;
    const { error } = await this.client
      .from("properties")
      .update({
        canonical_address: input.result.canonicalAddress,
        municipality: input.result.municipality,
        county: input.result.county,
        state_code: input.result.stateCode ?? "NJ",
        location,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.propertyId);
    if (error) throw new Error("Failed to update canonical property address");
  }

  async findDuplicateCandidates(input: {
    excludePropertyId: string;
    normalizedAddress: string;
    windowStartIso: string;
  }) {
    const { data: property, error: propertyError } = await this.client
      .from("properties")
      .select("company_id")
      .eq("id", input.excludePropertyId)
      .single();
    if (propertyError || !property) {
      throw new Error("Failed to load property for duplicate matching");
    }

    const { data: addresses, error: addressError } = await this.client
      .from("property_addresses")
      .select("property_id, canonical_address")
      .eq("company_id", property.company_id)
      .neq("property_id", input.excludePropertyId)
      .gte("created_at", input.windowStartIso)
      .not("canonical_address", "is", null);
    if (addressError) throw new Error("Failed to find duplicate addresses");

    const matchingPropertyIds = [
      ...new Set(
        (addresses ?? [])
          .filter(
            (address) =>
              address.canonical_address &&
              normalizeAddressForMatching(address.canonical_address) ===
                input.normalizedAddress,
          )
          .map((address) => address.property_id),
      ),
    ];
    if (matchingPropertyIds.length === 0) return [];

    const { data: candidates, error: candidateError } = await this.client
      .from("properties")
      .select("id")
      .in("id", matchingPropertyIds)
      .neq("resolution_status", "duplicate");
    if (candidateError) throw new Error("Failed to load duplicate candidates");
    return (candidates ?? []).map((candidate) => ({ propertyId: candidate.id }));
  }

  async mergeIntoCanonicalProperty(input: {
    placeholderPropertyId: string;
    canonicalPropertyId: string;
    leadId: string;
    pipelineRunId: string;
  }) {
    const { error: propertyError } = await this.client
      .from("properties")
      .update({
        resolution_status: "duplicate",
        merged_into_property_id: input.canonicalPropertyId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.placeholderPropertyId);
    if (propertyError) throw new Error("Failed to mark duplicate property");

    const { error: leadError } = await this.client
      .from("leads")
      .update({ property_id: input.canonicalPropertyId })
      .eq("id", input.leadId);
    if (leadError) throw new Error("Failed to merge duplicate lead");

    const { error: pipelineError } = await this.client
      .from("pipeline_runs")
      .update({
        property_id: input.canonicalPropertyId,
        status: "complete",
        finished_at: new Date().toISOString(),
      })
      .eq("id", input.pipelineRunId);
    if (pipelineError) throw new Error("Failed to complete duplicate pipeline");
  }

  async createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    reason: "low_address_confidence" | "duplicate_candidates";
    candidateData: unknown;
  }) {
    const { data: pipelineRun, error: pipelineError } = await this.client
      .from("pipeline_runs")
      .select("company_id")
      .eq("id", input.pipelineRunId)
      .single();
    if (pipelineError || !pipelineRun) {
      throw new Error("Failed to load pipeline run for review");
    }

    const { error: reviewError } = await this.client.from("review_tasks").insert({
      company_id: pipelineRun.company_id,
      pipeline_run_id: input.pipelineRunId,
      lead_id: input.leadId,
      property_id: input.propertyId,
      reason: input.reason,
      triggering_event_name: "property/address.validation_requested",
      candidate_data: input.candidateData as Json,
    });
    if (reviewError && reviewError.code !== "23505") {
      throw new Error("Failed to create address-validation review task");
    }

    const { error: propertyError } = await this.client
      .from("properties")
      .update({ resolution_status: "review_required" })
      .eq("id", input.propertyId);
    if (propertyError) throw new Error("Failed to mark property for review");

    const { error: runError } = await this.client
      .from("pipeline_runs")
      .update({ status: "review_required" })
      .eq("id", input.pipelineRunId);
    if (runError) throw new Error("Failed to mark pipeline for review");
  }

  async publishDiscoveryRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    canonicalAddress: string;
    latitude: number | null;
    longitude: number | null;
    attempt: number;
  }) {
    const { data: lead, error } = await this.client
      .from("leads")
      .select("company_id")
      .eq("id", input.leadId)
      .single();
    if (error || !lead) {
      throw new Error("Failed to load lead for property discovery trigger");
    }

    const event = createEventEnvelope({
      name: "property/discovery_requested",
      correlationId: input.correlationId,
      pipelineRunId: input.pipelineRunId,
      leadId: input.leadId,
      propertyId: input.propertyId,
      data: {
        leadId: input.leadId,
        propertyId: input.propertyId,
        canonicalAddress: input.canonicalAddress,
        latitude: input.latitude,
        longitude: input.longitude,
        attempt: input.attempt,
      },
    });
    await new SupabaseOutboxRepository(this.client).enqueue(event, lead.company_id);
  }

  async writeAudit(input: {
    action: string;
    propertyId: string;
    correlationId: string;
  }) {
    const { data: property, error } = await this.client
      .from("properties")
      .select("company_id")
      .eq("id", input.propertyId)
      .single();
    if (error || !property) throw new Error("Failed to load property for audit");

    await writeAuditEntry(
      {
        companyId: property.company_id,
        action: input.action,
        entityType: "property",
        entityId: input.propertyId,
        correlationId: input.correlationId,
      },
      this.client,
    );
  }
}

export const addressValidationWorker = inngest.createFunction(
  {
    id: "address-validation-worker",
    triggers: { event: addressValidationRequested },
  },
  async ({ event }) => {
    const envelope = event.data;
    return runAddressValidation(
      {
        id: envelope.id,
        pipelineRunId: envelope.pipelineRunId,
        correlationId: envelope.correlationId,
        leadId: envelope.data.leadId,
        propertyId: envelope.data.propertyId,
        submittedAddress: envelope.data.submittedAddress,
        attempt: envelope.data.attempt,
      },
      new SupabaseAddressValidationWorkerRepository(),
    );
  },
);
