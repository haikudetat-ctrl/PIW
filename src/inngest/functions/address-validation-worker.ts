import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  addressValidationResultSchema,
  type AddressValidationResult,
} from "@/domain/property-identity";
import { createEventEnvelope, eventEnvelopeSchema } from "@/domain/events";
import { addressValidationRequested, inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import type { Database, Json } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueAndPublishEvent } from "@/modules/events/enqueue-and-publish-event";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import type {
  ProviderAdapter,
  ProviderResult,
} from "@/modules/providers/contracts";
import { createPropertyIdentityProviderRegistry } from "@/modules/providers/property-identity-registry";
import { normalizeAddressForMatching } from "@/modules/property-identity/normalize-address";

const CONFIDENCE_REVIEW_THRESHOLD = 95;
const SCOPE_ERROR = "Address-validation scope mismatch";

function isHighConfidenceNjExactMatch(result: AddressValidationResult) {
  return (
    result.confidence >= CONFIDENCE_REVIEW_THRESHOLD &&
    result.matchMethod === "exact_single_match" &&
    result.stateCode === "NJ" &&
    result.canonicalAddress !== null
  );
}

export type WorkerRunRecord = { id: string; status: string };

type AddressValidationEvidence = ProviderResult<AddressValidationResult>;

const addressValidationEvidenceSchema = z.object({
  value: addressValidationResultSchema,
  provider: z.string().min(1),
  sourceIdentifier: z.string().min(1),
  retrievedAt: z.iso.datetime(),
  estimatedCostMicros: z.number().int().nonnegative(),
  actualCostMicros: z.number().int().nonnegative().optional(),
  rawArtifactId: z.string().min(1).optional(),
});

const addressValidationDecisionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("review"),
    reason: z.literal("low_address_confidence"),
  }),
  z.object({
    outcome: z.literal("review"),
    reason: z.literal("duplicate_candidates"),
    candidatePropertyIds: z.array(z.string().uuid()).min(2),
  }),
  z.object({
    outcome: z.literal("merge"),
    canonicalPropertyId: z.string().uuid(),
  }),
  z.object({ outcome: z.literal("discovery") }),
]);

export type AddressValidationDecision = z.infer<
  typeof addressValidationDecisionSchema
>;

const addressValidationAttemptSchema = z.object({
  evidence: addressValidationEvidenceSchema,
  providerRequestId: z.string().min(1),
  decision: addressValidationDecisionSchema.optional(),
});

const exactAssessmentPrefetchSchema = z.object({
  canonical_address: z.string().trim().min(1),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
});

export type AddressValidationAttempt = {
  evidence: AddressValidationEvidence;
  providerRequestId: string;
  decision?: AddressValidationDecision;
};

export type AddressClaimResult = {
  outcome: "discovery_requested" | "merged" | "review_required";
  observationPropertyId: string;
  canonicalPropertyId: string | null;
  candidatePropertyIds: string[];
  sideEffectsApplied: boolean;
};

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
  findExactAssessmentPrefetch(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
  }): Promise<null | {
    canonicalAddress: string;
    latitude: number;
    longitude: number;
  }>;
  startValidating(input: { pipelineRunId: string; companyId: string }): Promise<void>;
  validateAddress(input: {
    submittedAddress: string;
    googlePlaceId?: string;
    pipelineRunId: string;
    correlationId: string;
    companyId: string;
    attempt: number;
  }): Promise<AddressValidationEvidence>;
  loadWorkerAttempt(
    workerRunId: string,
  ): Promise<AddressValidationAttempt | null>;
  persistWorkerAttempt(input: {
    workerRunId: string;
    attempt: AddressValidationAttempt;
  }): Promise<AddressValidationAttempt>;
  persistWorkerDecision(input: {
    workerRunId: string;
    decision: AddressValidationDecision;
  }): Promise<AddressValidationAttempt>;
  beginProviderRequest(input: {
    pipelineRunId: string;
    companyId: string;
    workerRunId: string;
    attempt: number;
  }): Promise<{ providerRequestId: string }>;
  completeProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
    evidence: AddressValidationEvidence;
  }): Promise<void>;
  failProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
    failureCode: "provider_execution_failed";
    failureMetadata: { capability: "address.validate"; attempt: number };
  }): Promise<void>;
  claimCanonicalAddress(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    companyId: string;
    workerRunId: string;
    providerRequestId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    attempt: number;
  }): Promise<AddressClaimResult>;
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
    attempt: number;
    workerRunId: string;
  }): Promise<void>;
  continueRoofEstimateAfterMerge(input: {
    leadId: string;
    pipelineRunId: string;
    companyId: string;
    canonicalPropertyId: string;
  }): Promise<boolean>;
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
  googlePlaceId?: string;
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

  const prefetch = await repository.findExactAssessmentPrefetch({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  });
  if (prefetch !== null) {
    await repository.markWorkerRunCompleted(workerRun.id);
    return { workerRunId: workerRun.id, outcome: "already_prefetched" as const };
  }

  await repository.startValidating({ pipelineRunId: event.pipelineRunId, companyId });

  let attempt = await repository.loadWorkerAttempt(workerRun.id);
  if (attempt === null) {
    const { providerRequestId } = await repository.beginProviderRequest({
      pipelineRunId: event.pipelineRunId,
      companyId,
      workerRunId: workerRun.id,
      attempt: event.attempt,
    });
    try {
      const evidence = await repository.validateAddress({
        submittedAddress: event.submittedAddress,
        googlePlaceId: event.googlePlaceId,
        pipelineRunId: event.pipelineRunId,
        correlationId: event.correlationId,
        companyId,
        attempt: event.attempt,
      });
      attempt = await repository.persistWorkerAttempt({
        workerRunId: workerRun.id,
        attempt: { evidence, providerRequestId },
      });
    } catch (error) {
      await repository.failProviderRequest({
        providerRequestId,
        companyId,
        failureCode: "provider_execution_failed",
        failureMetadata: {
          capability: "address.validate",
          attempt: event.attempt,
        },
      });
      throw error;
    }
  }
  const evidence = attempt.evidence;
  const result = attempt.evidence.value;
  const providerRequestId = attempt.providerRequestId;
  await repository.completeProviderRequest({
    providerRequestId,
    companyId,
    evidence,
  });

  const claim = await repository.claimCanonicalAddress({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
    companyId,
    workerRunId: workerRun.id,
    providerRequestId,
    submittedAddress: event.submittedAddress,
    result,
    attempt: event.attempt,
  });
  let outcome: "review_required" | "merged" | "discovery_requested";
  const observationPropertyId = claim.observationPropertyId;

  if (claim.outcome === "review_required") {
    const lowAddressConfidence = !isHighConfidenceNjExactMatch(result);
    await repository.createReviewTask({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
      companyId,
      reason: lowAddressConfidence
        ? "low_address_confidence"
        : "duplicate_candidates",
      candidateData: lowAddressConfidence
        ? { result }
        : { candidatePropertyIds: claim.candidatePropertyIds },
      attempt: event.attempt,
      workerRunId: workerRun.id,
    });
    outcome = "review_required";
  } else if (claim.outcome === "merged") {
    const canonicalPropertyId = claim.canonicalPropertyId;
    const continueRoofEstimate =
      canonicalPropertyId !== null &&
      (await repository.continueRoofEstimateAfterMerge({
        leadId: event.leadId,
        pipelineRunId: event.pipelineRunId,
        companyId,
        canonicalPropertyId,
      }));
    if (continueRoofEstimate && canonicalPropertyId) {
      await repository.publishDiscoveryRequested({
        leadId: event.leadId,
        propertyId: canonicalPropertyId,
        pipelineRunId: event.pipelineRunId,
        companyId,
        correlationId: event.correlationId,
        canonicalAddress: result.canonicalAddress ?? event.submittedAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        attempt: 1,
      });
      outcome = "discovery_requested";
    } else {
      outcome = "merged";
    }
  } else {
    await repository.publishDiscoveryRequested({
      leadId: event.leadId,
      propertyId: claim.canonicalPropertyId ?? event.propertyId,
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

  async findExactAssessmentPrefetch(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
  }) {
    const { data: pipelineRun, error: pipelineError } = await this.client
      .from("pipeline_runs")
      .select("company_id")
      .eq("id", input.pipelineRunId)
      .eq("lead_id", input.leadId)
      .eq("property_id", input.propertyId)
      .maybeSingle();
    if (pipelineError) {
      throw new Error("Failed to check assessment-prefetch pipeline scope");
    }
    if (!pipelineRun) return null;

    const { data: startedEventRow, error: startedEventError } = await this.client
      .from("domain_events")
      .select("id, correlation_id, idempotency_key, payload")
      .eq("company_id", pipelineRun.company_id)
      .eq("pipeline_run_id", input.pipelineRunId)
      .eq("event_name", "roof/assessment.started")
      .eq("schema_version", 1)
      .maybeSingle();
    if (startedEventError) {
      throw new Error("Failed to check assessment-prefetch started event");
    }
    if (!startedEventRow) return null;

    const startedEvent = eventEnvelopeSchema.safeParse(startedEventRow.payload);
    if (
      !startedEvent.success ||
      startedEvent.data.name !== "roof/assessment.started" ||
      startedEvent.data.id !== startedEventRow.id ||
      startedEvent.data.correlationId !== startedEventRow.correlation_id ||
      startedEvent.data.idempotencyKey !== startedEventRow.idempotency_key ||
      startedEvent.data.pipelineRunId !== input.pipelineRunId ||
      startedEvent.data.leadId !== input.leadId ||
      startedEvent.data.propertyId !== input.propertyId ||
      startedEvent.data.idempotencyKey !==
        `roof/assessment.started:${startedEvent.data.data.assessmentId}`
    ) {
      return null;
    }

    const { data, error } = await this.client
      .from("property_addresses")
      .select(`
        canonical_address,
        latitude,
        longitude,
        roof_assessment_access_attempts!property_addresses_company_access_attempt_fkey!inner(
          company_id,
          lead_id,
          property_id,
          attempt_kind
        )
      `)
      .eq("company_id", pipelineRun.company_id)
      .eq("property_id", input.propertyId)
      .eq("roof_assessment_access_attempts.company_id", pipelineRun.company_id)
      .eq("roof_assessment_access_attempts.lead_id", input.leadId)
      .eq("roof_assessment_access_attempts.property_id", input.propertyId)
      .eq(
        "roof_assessment_access_attempts.assessment_id",
        startedEvent.data.data.assessmentId,
      )
      .eq("roof_assessment_access_attempts.attempt_kind", "new")
      .eq("state_code", "NJ")
      .eq("match_method", "exact_single_match")
      .gte("confidence", CONFIDENCE_REVIEW_THRESHOLD)
      .not("assessment_access_attempt_id", "is", null)
      .not("canonical_address", "is", null)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Failed to check exact assessment prefetch");
    if (!data) return null;

    const parsed = exactAssessmentPrefetchSchema.safeParse(data);
    if (!parsed.success) return null;
    return {
      canonicalAddress: parsed.data.canonical_address,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    };
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
    googlePlaceId?: string;
    pipelineRunId: string;
    correlationId: string;
    companyId: string;
    attempt: number;
  }) {
    const environment = parseServerEnv(process.env);
    const provider = createPropertyIdentityProviderRegistry().resolve(
      "address.validate",
    ) as ProviderAdapter<{ submittedAddress: string; googlePlaceId?: string }, AddressValidationResult>;
    return provider.execute(
      { submittedAddress: input.submittedAddress, googlePlaceId: input.googlePlaceId },
      {
        companyId: input.companyId,
        pipelineRunId: input.pipelineRunId,
        correlationId: input.correlationId,
        requestKey: `address.validate:${input.pipelineRunId}:${input.attempt}`,
        deploymentEnvironment: environment.DEPLOYMENT_ENV,
      },
    );
  }

  async loadWorkerAttempt(workerRunId: string) {
    const { data, error } = await this.client
      .from("worker_runs")
      .select("output")
      .eq("id", workerRunId)
      .single();
    if (error || !data) {
      throw new Error("Failed to load address-validation attempt");
    }
    if (data.output === null) return null;

    const parsed = addressValidationAttemptSchema.safeParse(data.output);
    if (!parsed.success) {
      throw new Error("Stored address-validation attempt is invalid");
    }
    return parsed.data;
  }

  async persistWorkerAttempt(input: {
    workerRunId: string;
    attempt: AddressValidationAttempt;
  }) {
    const validatedAttempt = addressValidationAttemptSchema.parse(input.attempt);
    const { data: updated, error } = await this.client
      .from("worker_runs")
      .update({ output: validatedAttempt as unknown as Json })
      .eq("id", input.workerRunId)
      .is("output", null)
      .select("output")
      .maybeSingle();
    if (error) {
      throw new Error("Failed to persist address-validation attempt");
    }

    if (updated?.output) {
      return addressValidationAttemptSchema.parse(updated.output);
    }

    const existing = await this.loadWorkerAttempt(input.workerRunId);
    if (existing === null) {
      throw new Error("Failed to load persisted address-validation attempt");
    }
    return existing;
  }

  async persistWorkerDecision(input: {
    workerRunId: string;
    decision: AddressValidationDecision;
  }) {
    const existing = await this.loadWorkerAttempt(input.workerRunId);
    if (existing === null) {
      throw new Error("Address-validation evidence must be persisted first");
    }
    if (existing.decision !== undefined) return existing;

    const candidate = addressValidationAttemptSchema.parse({
      ...existing,
      decision: input.decision,
    });
    const { data: updated, error } = await this.client
      .from("worker_runs")
      .update({ output: candidate as unknown as Json })
      .eq("id", input.workerRunId)
      .is("output->decision", null)
      .select("output")
      .maybeSingle();
    if (error) {
      throw new Error("Failed to persist address-validation decision");
    }
    if (updated?.output) {
      return addressValidationAttemptSchema.parse(updated.output);
    }

    const winner = await this.loadWorkerAttempt(input.workerRunId);
    if (winner?.decision === undefined) {
      throw new Error("Failed to load persisted address-validation decision");
    }
    return winner;
  }

  async beginProviderRequest(input: {
    pipelineRunId: string;
    companyId: string;
    workerRunId: string;
    attempt: number;
  }) {
    const requestKey = `address.validate:${input.pipelineRunId}:${input.attempt}`;
    const { data: inserted, error: insertError } = await this.client
      .from("provider_requests")
      .insert({
        company_id: input.companyId,
        pipeline_run_id: input.pipelineRunId,
        worker_run_id: input.workerRunId,
        attempt: input.attempt,
        capability: "address.validate",
        provider: "google_places",
        request_key: requestKey,
        status: "requested",
      })
      .select("id")
      .single();
    if (!insertError && inserted) {
      return { providerRequestId: inserted.id };
    }
    if (insertError?.code !== "23505") {
      throw new Error("Failed to start address-validation provider request");
    }

    const { data: existing, error: selectError } = await this.client
      .from("provider_requests")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("request_key", requestKey)
      .single();
    if (selectError || !existing) {
      throw new Error("Failed to load address-validation provider request");
    }
    return { providerRequestId: existing.id };
  }

  async completeProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
    evidence: AddressValidationEvidence;
  }) {
    const { error: requestError } = await this.client
      .from("provider_requests")
      .update({
        provider: input.evidence.provider,
        status: "succeeded",
        completed_at: input.evidence.retrievedAt,
      })
      .eq("id", input.providerRequestId)
      .eq("company_id", input.companyId);
    if (requestError) {
      throw new Error("Failed to complete address-validation provider request");
    }

    const { error: costError } = await this.client
      .from("provider_cost_entries")
      .upsert(
        {
          provider_request_id: input.providerRequestId,
          estimated_cost_micros: input.evidence.estimatedCostMicros,
          actual_cost_micros:
            input.evidence.actualCostMicros ??
            input.evidence.estimatedCostMicros,
        },
        { onConflict: "provider_request_id" },
      );
    if (costError) {
      throw new Error("Failed to record address-validation provider cost");
    }

    const { error: sourceError } = await this.client.from("source_records").upsert(
      {
        company_id: input.companyId,
        provider: input.evidence.provider,
        source_identifier: `${input.companyId}:${input.evidence.sourceIdentifier}`,
        retrieved_at: input.evidence.retrievedAt,
        raw_payload: input.evidence.value as unknown as Json,
      },
      {
        onConflict: "provider,source_identifier,retrieved_at",
        ignoreDuplicates: true,
      },
    );
    if (sourceError) {
      throw new Error("Failed to record address-validation source");
    }
  }

  async failProviderRequest(input: {
    providerRequestId: string;
    companyId: string;
    failureCode: "provider_execution_failed";
    failureMetadata: { capability: "address.validate"; attempt: number };
  }) {
    const { error: requestError } = await this.client
      .from("provider_requests")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.providerRequestId)
      .eq("company_id", input.companyId);
    if (requestError) {
      throw new Error("Failed to close address-validation provider request");
    }

    const { error: costError } = await this.client
      .from("provider_cost_entries")
      .upsert(
        {
          provider_request_id: input.providerRequestId,
          estimated_cost_micros: 0,
          actual_cost_micros: 0,
        },
        { onConflict: "provider_request_id" },
      );
    if (costError) {
      throw new Error("Failed to record address-validation provider cost");
    }
  }

  async claimCanonicalAddress(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    companyId: string;
    workerRunId: string;
    providerRequestId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    attempt: number;
  }): Promise<AddressClaimResult> {
    // The `claim_property_address` RPC performs candidate lookup, the
    // canonical-property update or duplicate merge, and the
    // property_addresses observation insert as one atomic transaction
    // (row locks plus an advisory lock on tenant+normalized-address),
    // replacing what used to be several separate, race-prone client calls.
    const { data, error } = await this.client.rpc("claim_property_address", {
      p_company_id: input.companyId,
      p_pipeline_run_id: input.pipelineRunId,
      p_lead_id: input.leadId,
      p_property_id: input.propertyId,
      p_worker_run_id: input.workerRunId,
      p_provider_request_id: input.providerRequestId,
      p_submitted_address: input.submittedAddress,
      // The RPC's generated Args type marks these as non-nullable strings
      // even though the SQL parameters are nullable; the underlying
      // function accepts null for an unmatched/out-of-state address.
      p_canonical_address: input.result.canonicalAddress as unknown as string,
      p_latitude: input.result.latitude as unknown as number,
      p_longitude: input.result.longitude as unknown as number,
      p_municipality: input.result.municipality as unknown as string,
      p_county: input.result.county as unknown as string,
      p_state_code: input.result.stateCode as unknown as string,
      p_zip: input.result.zip as unknown as string,
      p_match_method: input.result.matchMethod,
      p_confidence: input.result.confidence,
      p_attempt: input.attempt,
    });
    if (error || !data?.[0]) {
      throw new Error("Failed to claim canonical address");
    }

    if (input.result.googlePlaceId) {
      const { error: placeIdError } = await this.client
        .from("property_addresses")
        .update({ google_place_id: input.result.googlePlaceId })
        .eq("worker_run_id", input.workerRunId)
        .eq("company_id", input.companyId);
      if (placeIdError) throw new Error("Failed to store Google Place ID");
    }

    const claim = data[0];
    if (
      claim.outcome !== "discovery_requested" &&
      claim.outcome !== "merged" &&
      claim.outcome !== "review_required"
    ) {
      throw new Error(`Unexpected address-claim outcome: ${claim.outcome}`);
    }

    return {
      outcome: claim.outcome,
      observationPropertyId: claim.observation_property_id,
      canonicalPropertyId: claim.canonical_property_id,
      candidatePropertyIds: claim.candidate_property_ids ?? [],
      sideEffectsApplied: claim.side_effects_applied,
    };
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
    if (input.result.stateCode !== "NJ") {
      throw new Error("Canonical property address must be in New Jersey");
    }
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
        state_code: input.result.stateCode,
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
    attempt: number;
    workerRunId: string;
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
      retry_count: input.attempt - 1,
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

    const { error: estimateError } = await this.client
      .from("roof_estimates")
      .update({
        status: "review_required",
        failure_reason: "Address match requires manual review",
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.leadId)
      .eq("company_id", input.companyId)
      .eq("status", "pending");
    if (estimateError) throw new Error("Failed to mark roof estimate for review");
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
    await enqueueAndPublishEvent({
      repository: new SupabaseOutboxRepository(this.client),
      event,
      companyId: input.companyId,
      send: (outbound) => inngest.send(outbound),
    });
  }

  async continueRoofEstimateAfterMerge(input: {
    leadId: string;
    pipelineRunId: string;
    companyId: string;
    canonicalPropertyId: string;
  }) {
    const { data: estimate, error: estimateLookupError } = await this.client
      .from("roof_estimates")
      .select("id")
      .eq("lead_id", input.leadId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (estimateLookupError) {
      throw new Error("Failed to check merged roof estimate");
    }
    if (!estimate) return false;

    const { error: estimateUpdateError } = await this.client
      .from("roof_estimates")
      .update({ property_id: input.canonicalPropertyId })
      .eq("id", estimate.id)
      .eq("company_id", input.companyId);
    if (estimateUpdateError) {
      throw new Error("Failed to attach merged roof estimate");
    }

    const { error: pipelineUpdateError } = await this.client
      .from("pipeline_runs")
      .update({
        property_id: input.canonicalPropertyId,
        status: "validating",
        finished_at: null,
      })
      .eq("id", input.pipelineRunId)
      .eq("company_id", input.companyId)
      .eq("lead_id", input.leadId);
    if (pipelineUpdateError) {
      throw new Error("Failed to continue merged roof estimate");
    }
    return true;
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
        googlePlaceId: envelope.data.googlePlaceId,
        attempt: envelope.data.attempt,
      },
      new SupabaseAddressValidationWorkerRepository(),
    );
  },
);
