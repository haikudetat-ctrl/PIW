import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AddressValidationResult } from "@/domain/property-identity";
import { createEventEnvelope } from "@/domain/events";
import { addressValidationRequested, inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import type { Database, Json } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
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
const SCOPE_ERROR = "Address-validation scope mismatch";

export type WorkerRunRecord = { id: string; status: string };

type AddressValidationEvidence = ProviderResult<AddressValidationResult>;

export interface AddressValidationWorkerRepository {
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
  startValidating(input: { pipelineRunId: string; companyId: string }): Promise<void>;
  validateAddress(input: {
    submittedAddress: string;
    pipelineRunId: string;
    correlationId: string;
    companyId: string;
  }): Promise<AddressValidationEvidence>;
  recordProviderEvidence(input: {
    pipelineRunId: string;
    companyId: string;
    evidence: AddressValidationEvidence;
  }): Promise<{ providerRequestId?: string }>;
  recordPropertyAddress(input: {
    propertyId: string;
    companyId: string;
    workerRunId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    providerRequestId?: string;
  }): Promise<boolean>;
  updateCanonicalPropertyFields(input: {
    propertyId: string;
    companyId: string;
    result: AddressValidationResult;
  }): Promise<void>;
  findDuplicateCandidates(input: {
    excludePropertyId: string;
    companyId: string;
    normalizedAddress: string;
    windowStartIso: string;
  }): Promise<{ propertyId: string }[]>;
  mergeIntoCanonicalProperty(input: {
    placeholderPropertyId: string;
    canonicalPropertyId: string;
    leadId: string;
    pipelineRunId: string;
    companyId: string;
  }): Promise<void>;
  createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    companyId: string;
    reason: "low_address_confidence" | "duplicate_candidates";
    candidateData: unknown;
  }): Promise<void>;
  publishDiscoveryRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    companyId: string;
    correlationId: string;
    canonicalAddress: string;
    latitude: number | null;
    longitude: number | null;
    attempt: number;
  }): Promise<void>;
  writeAudit(input: {
    action: string;
    propertyId: string;
    companyId: string;
    correlationId: string;
    workerRunId: string;
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
  const { companyId } = await repository.assertEventScope({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  });
  const idempotencyKey = `address-validation-worker:${event.pipelineRunId}:${event.attempt}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  if (workerRun.status === "completed") {
    return { workerRunId: workerRun.id, outcome: "already_completed" as const };
  }

  await repository.startValidating({ pipelineRunId: event.pipelineRunId, companyId });

  const evidence = await repository.validateAddress({
    submittedAddress: event.submittedAddress,
    pipelineRunId: event.pipelineRunId,
    correlationId: event.correlationId,
    companyId,
  });
  const result = evidence.value;
  const { providerRequestId } = await repository.recordProviderEvidence({
    pipelineRunId: event.pipelineRunId,
    companyId,
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
      companyId,
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

  await repository.recordPropertyAddress({
    propertyId: observationPropertyId,
    companyId,
    workerRunId: workerRun.id,
    submittedAddress: event.submittedAddress,
    result,
    providerRequestId,
  });
  if (result.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    await repository.createReviewTask({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
      companyId,
      reason: "low_address_confidence",
      candidateData: { result },
    });
    outcome = "review_required";
  } else {
    await repository.updateCanonicalPropertyFields({
      propertyId: observationPropertyId,
      companyId,
      result,
    });

    if (duplicateDecision?.outcome === "ambiguous") {
      await repository.createReviewTask({
        pipelineRunId: event.pipelineRunId,
        leadId: event.leadId,
        propertyId: event.propertyId,
        companyId,
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
        companyId,
      });
      outcome = "merged";
    } else {
      await repository.publishDiscoveryRequested({
        leadId: event.leadId,
        propertyId: event.propertyId,
        pipelineRunId: event.pipelineRunId,
        companyId,
        correlationId: event.correlationId,
        canonicalAddress: result.canonicalAddress ?? event.submittedAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        attempt: 1,
      });
      outcome = "discovery_requested";
    }
  }

  await repository.writeAudit({
    action:
      outcome === "review_required"
        ? "property.address_validation_review_required"
        : "property.address_validated",
    propertyId: observationPropertyId,
    companyId,
    correlationId: event.correlationId,
    workerRunId: workerRun.id,
  });
  await repository.markWorkerRunCompleted(workerRun.id);

  return { workerRunId: workerRun.id, outcome };
}

export class SupabaseAddressValidationWorkerRepository
  implements AddressValidationWorkerRepository
{
  constructor(
    private readonly client: SupabaseClient<Database> = createServiceClient(),
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

    const canonicalPropertyId = property?.merged_into_property_id;
    const isDirectLink =
      !canonicalPropertyId &&
      lead?.property_id === input.propertyId &&
      pipelineRun?.property_id === input.propertyId;
    const isMergeReplay =
      Boolean(canonicalPropertyId) &&
      [input.propertyId, canonicalPropertyId].includes(lead?.property_id ?? "") &&
      [input.propertyId, canonicalPropertyId].includes(
        pipelineRun?.property_id ?? "",
      );
    if (
      pipelineError ||
      leadError ||
      propertyError ||
      !pipelineRun ||
      !lead ||
      !property ||
      pipelineRun.lead_id !== input.leadId ||
      (!isDirectLink && !isMergeReplay) ||
      pipelineRun.company_id !== lead.company_id ||
      pipelineRun.company_id !== property.company_id
    ) {
      throw new Error(SCOPE_ERROR);
    }

    if (isMergeReplay) {
      const { data: canonical, error: canonicalError } = await this.client
        .from("properties")
        .select("company_id")
        .eq("id", canonicalPropertyId!)
        .single();
      if (
        canonicalError ||
        !canonical ||
        canonical.company_id !== pipelineRun.company_id
      ) {
        throw new Error(SCOPE_ERROR);
      }
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

  async startValidating(input: { pipelineRunId: string; companyId: string }) {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({ status: "validating" })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId)
      .eq("status", "received");
    if (error) throw new Error("Failed to start address validation");
  }

  async validateAddress(input: {
    submittedAddress: string;
    pipelineRunId: string;
    correlationId: string;
    companyId: string;
  }) {
    const environment = parseServerEnv(process.env);
    const provider = createPropertyIdentityProviderRegistry().resolve(
      "address.validate",
    ) as ProviderAdapter<{ submittedAddress: string }, AddressValidationResult>;
    return provider.execute(
      { submittedAddress: input.submittedAddress },
      {
        companyId: input.companyId,
        pipelineRunId: input.pipelineRunId,
        correlationId: input.correlationId,
        requestKey: `address.validate:${input.pipelineRunId}`,
        deploymentEnvironment: environment.DEPLOYMENT_ENV,
      },
    );
  }

  async recordProviderEvidence(input: {
    pipelineRunId: string;
    companyId: string;
    evidence: AddressValidationEvidence;
  }) {
    const requestKey = `address.validate:${input.pipelineRunId}`;
    const { data: inserted, error: insertError } = await this.client
      .from("provider_requests")
      .insert({
        company_id: input.companyId,
        pipeline_run_id: input.pipelineRunId,
        capability: "address.validate",
        provider: input.evidence.provider,
        request_key: requestKey,
        status: "succeeded",
        requested_at: input.evidence.retrievedAt,
        completed_at: input.evidence.retrievedAt,
      })
      .select("id, requested_at, completed_at")
      .single();

    if (insertError && insertError.code !== "23505") {
      throw new Error("Failed to record address-validation provider request");
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
        throw new Error("Failed to load address-validation provider request");
      }
      providerRequest = existing;
    }

    const { error: sourceError } = await this.client.from("source_records").upsert(
      {
        company_id: input.companyId,
        provider: input.evidence.provider,
        source_identifier: input.evidence.sourceIdentifier,
        retrieved_at:
          providerRequest.completed_at ?? providerRequest.requested_at,
        raw_payload: input.evidence.value as unknown as Json,
      },
      {
        onConflict: "provider,source_identifier,retrieved_at",
        ignoreDuplicates: true,
      },
    );
    if (sourceError) throw new Error("Failed to record address-validation source");

    return { providerRequestId: providerRequest.id };
  }

  async recordPropertyAddress(input: {
    propertyId: string;
    companyId: string;
    workerRunId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    providerRequestId?: string;
  }) {
    const { data: property, error: propertyError } = await this.client
      .from("properties")
      .select("company_id")
      .eq("id", input.propertyId)
      .eq("company_id", input.companyId)
      .single();
    if (propertyError || !property) {
      throw new Error(SCOPE_ERROR);
    }

    const location =
      input.result.longitude === null || input.result.latitude === null
        ? null
        : `SRID=4326;POINT(${input.result.longitude} ${input.result.latitude})`;
    const { error } = await this.client.from("property_addresses").insert({
      company_id: input.companyId,
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
    companyId: string;
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
      .eq("id", input.propertyId)
      .eq("company_id", input.companyId);
    if (error) throw new Error("Failed to update canonical property address");
  }

  async findDuplicateCandidates(input: {
    excludePropertyId: string;
    companyId: string;
    normalizedAddress: string;
    windowStartIso: string;
  }) {
    const { data: addresses, error: addressError } = await this.client
      .from("property_addresses")
      .select("property_id, canonical_address")
      .eq("company_id", input.companyId)
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
      .eq("company_id", input.companyId)
      .neq("resolution_status", "duplicate");
    if (candidateError) throw new Error("Failed to load duplicate candidates");
    return (candidates ?? []).map((candidate) => ({ propertyId: candidate.id }));
  }

  async mergeIntoCanonicalProperty(input: {
    placeholderPropertyId: string;
    canonicalPropertyId: string;
    leadId: string;
    pipelineRunId: string;
    companyId: string;
  }) {
    const { data: placeholder, error: placeholderError } = await this.client
      .from("properties")
      .select("company_id, merged_into_property_id")
      .eq("id", input.placeholderPropertyId)
      .single();
    const { data: canonical, error: canonicalError } = await this.client
      .from("properties")
      .select("company_id")
      .eq("id", input.canonicalPropertyId)
      .single();
    const { data: lead, error: leadScopeError } = await this.client
      .from("leads")
      .select("company_id, property_id")
      .eq("id", input.leadId)
      .single();
    const { data: pipelineRun, error: pipelineScopeError } = await this.client
      .from("pipeline_runs")
      .select("company_id, lead_id, property_id")
      .eq("id", input.pipelineRunId)
      .single();
    if (
      placeholderError ||
      canonicalError ||
      leadScopeError ||
      pipelineScopeError ||
      !placeholder ||
      !canonical ||
      !lead ||
      !pipelineRun ||
      placeholder.company_id !== input.companyId ||
      canonical.company_id !== input.companyId ||
      lead.company_id !== input.companyId ||
      pipelineRun.company_id !== input.companyId ||
      pipelineRun.lead_id !== input.leadId ||
      ![input.placeholderPropertyId, input.canonicalPropertyId].includes(
        lead.property_id ?? "",
      ) ||
      ![input.placeholderPropertyId, input.canonicalPropertyId].includes(
        pipelineRun.property_id ?? "",
      ) ||
      (placeholder.merged_into_property_id !== null &&
        placeholder.merged_into_property_id !== input.canonicalPropertyId)
    ) {
      throw new Error(SCOPE_ERROR);
    }

    const { error: propertyError } = await this.client
      .from("properties")
      .update({
        resolution_status: "duplicate",
        merged_into_property_id: input.canonicalPropertyId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.placeholderPropertyId)
      .eq("company_id", input.companyId);
    if (propertyError) throw new Error("Failed to mark duplicate property");

    const { error: leadError } = await this.client
      .from("leads")
      .update({ property_id: input.canonicalPropertyId })
      .eq("id", input.leadId)
      .eq("company_id", input.companyId);
    if (leadError) throw new Error("Failed to merge duplicate lead");

    const { error: pipelineError } = await this.client
      .from("pipeline_runs")
      .update({
        property_id: input.canonicalPropertyId,
        status: "complete",
        finished_at: new Date().toISOString(),
      })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId);
    if (pipelineError) throw new Error("Failed to complete duplicate pipeline");
  }

  async createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    companyId: string;
    reason: "low_address_confidence" | "duplicate_candidates";
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
      triggering_event_name: "property/address.validation_requested",
      candidate_data: input.candidateData as Json,
    });
    if (reviewError && reviewError.code !== "23505") {
      throw new Error("Failed to create address-validation review task");
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

  async publishDiscoveryRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    companyId: string;
    correlationId: string;
    canonicalAddress: string;
    latitude: number | null;
    longitude: number | null;
    attempt: number;
  }) {
    const scope = await this.assertEventScope(input);
    if (scope.companyId !== input.companyId) throw new Error(SCOPE_ERROR);

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
    await new SupabaseOutboxRepository(this.client).enqueue(event, input.companyId);
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
      throw new Error("Failed to write address-validation audit entry");
    }
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
