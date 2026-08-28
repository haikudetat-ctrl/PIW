import { expect, test, vi } from "vitest";
import type { AddressValidationResult } from "@/domain/property-identity";
import type { ProviderResult } from "@/modules/providers/contracts";
import {
  runAddressValidation,
  SupabaseAddressValidationWorkerRepository,
  type AddressClaimResult,
  type AddressValidationAttempt,
  type AddressValidationDecision,
  type AddressValidationWorkerRepository,
  type WorkerRunRecord,
} from "./address-validation-worker";

const VALIDATED_ADDRESS: AddressValidationResult = {
  submittedAddress: "12 Birch St, Trenton, NJ",
  canonicalAddress: "12 BIRCH ST, TRENTON, NJ, 08611",
  latitude: 40.22,
  longitude: -74.76,
  municipality: "TRENTON",
  county: null,
  stateCode: "NJ",
  zip: "08611",
  matchMethod: "exact_single_match",
  confidence: 97,
};

function evidence(value: AddressValidationResult): ProviderResult<AddressValidationResult> {
  return {
    value,
    provider: "census_geocoder",
    sourceIdentifier: value.canonicalAddress ?? value.submittedAddress,
    retrievedAt: "2026-07-29T12:00:00.000Z",
    estimatedCostMicros: 0,
  };
}

function makeRepository(overrides: Partial<AddressValidationWorkerRepository> = {}) {
  const workerRuns = new Map<string, WorkerRunRecord>();
  const addressWorkerRuns = new Set<string>();
  const attempts = new Map<string, AddressValidationAttempt>();
  const claims = new Map<string, AddressClaimResult>();
  const auditKeys = new Set<string>();
  let addressWrites = 0;
  let completions = 0;
  let auditWrites = 0;
  let validations = 0;

  const repository: AddressValidationWorkerRepository = {
    async assertEventScope() {
      return { companyId: "99999999-9999-4999-8999-999999999999" };
    },
    async upsertWorkerRunQueued({ idempotencyKey }) {
      const existing = workerRuns.get(idempotencyKey);
      if (existing) return { ...existing };
      const record: WorkerRunRecord = { id: idempotencyKey, status: "queued" };
      workerRuns.set(idempotencyKey, record);
      return { ...record };
    },
    async markWorkerRunCompleted(workerRunId) {
      const record = workerRuns.get(workerRunId);
      if (!record || record.status === "completed") return;
      completions += 1;
      record.status = "completed";
    },
    async startValidating() {},
    async findExactAssessmentPrefetch() {
      return null;
    },
    async validateAddress() {
      validations += 1;
      return evidence(VALIDATED_ADDRESS);
    },
    async loadWorkerAttempt(workerRunId) {
      return attempts.get(workerRunId) ?? null;
    },
    async persistWorkerAttempt({ workerRunId, attempt }) {
      const existing = attempts.get(workerRunId);
      if (existing) return existing;
      attempts.set(workerRunId, attempt);
      return attempt;
    },
    async persistWorkerDecision({ workerRunId, decision }) {
      const attempt = attempts.get(workerRunId);
      if (!attempt) throw new Error("missing address attempt");
      if (attempt.decision) return attempt;
      const completedAttempt: AddressValidationAttempt = {
        ...attempt,
        decision: decision as AddressValidationDecision,
      };
      attempts.set(workerRunId, completedAttempt);
      return completedAttempt;
    },
    async beginProviderRequest() {
      return { providerRequestId: "provider-request-1" };
    },
    async completeProviderRequest() {},
    async failProviderRequest() {},
    async claimCanonicalAddress(input) {
      const existingClaim = claims.get(input.workerRunId);
      if (existingClaim) {
        return { ...existingClaim, sideEffectsApplied: false };
      }
      const isNjExact =
        input.result.confidence >= 95 &&
        input.result.matchMethod === "exact_single_match" &&
        input.result.stateCode === "NJ";
      if (!isNjExact) {
        await repository.recordPropertyAddress({
          ...input,
          propertyId: input.propertyId,
        });
        const claim: AddressClaimResult = {
          outcome: "review_required",
          observationPropertyId: input.propertyId,
          canonicalPropertyId: null,
          candidatePropertyIds: [],
          sideEffectsApplied: true,
        };
        claims.set(input.workerRunId, claim);
        return claim;
      }

      const candidates = await repository.findDuplicateCandidates({
        excludePropertyId: input.propertyId,
        companyId: input.companyId,
        normalizedAddress: input.result.canonicalAddress ?? input.submittedAddress,
        windowStartIso: "2026-01-30T00:00:00.000Z",
      });
      if (candidates.length === 1) {
        const canonicalPropertyId = candidates[0].propertyId;
        await repository.recordPropertyAddress({
          ...input,
          propertyId: canonicalPropertyId,
        });
        await repository.updateCanonicalPropertyFields({
          propertyId: canonicalPropertyId,
          companyId: input.companyId,
          result: input.result,
        });
        await repository.mergeIntoCanonicalProperty({
          placeholderPropertyId: input.propertyId,
          canonicalPropertyId,
          leadId: input.leadId,
          pipelineRunId: input.pipelineRunId,
          companyId: input.companyId,
        });
        const claim: AddressClaimResult = {
          outcome: "merged",
          observationPropertyId: canonicalPropertyId,
          canonicalPropertyId,
          candidatePropertyIds: [canonicalPropertyId],
          sideEffectsApplied: true,
        };
        claims.set(input.workerRunId, claim);
        return claim;
      }

      await repository.recordPropertyAddress({
        ...input,
        propertyId: input.propertyId,
      });
      await repository.updateCanonicalPropertyFields({
        propertyId: input.propertyId,
        companyId: input.companyId,
        result: input.result,
      });
      if (candidates.length > 1) {
        const claim: AddressClaimResult = {
          outcome: "review_required",
          observationPropertyId: input.propertyId,
          canonicalPropertyId: null,
          candidatePropertyIds: candidates.map((candidate) => candidate.propertyId),
          sideEffectsApplied: true,
        };
        claims.set(input.workerRunId, claim);
        return claim;
      }
      const claim: AddressClaimResult = {
        outcome: "discovery_requested",
        observationPropertyId: input.propertyId,
        canonicalPropertyId: input.propertyId,
        candidatePropertyIds: [],
        sideEffectsApplied: true,
      };
      claims.set(input.workerRunId, claim);
      return claim;
    },
    async recordProviderEvidence() {
      return { providerRequestId: "provider-request-1" };
    },
    async recordPropertyAddress(input) {
      if (addressWorkerRuns.has(input.workerRunId)) return false;
      addressWorkerRuns.add(input.workerRunId);
      addressWrites += 1;
      return true;
    },
    async updateCanonicalPropertyFields() {},
    async findDuplicateCandidates() {
      return [];
    },
    async mergeIntoCanonicalProperty() {},
    async createReviewTask() {},
    async continueRoofEstimateAfterMerge() {
      return false;
    },
    async publishDiscoveryRequested() {},
    async writeAudit(input) {
      const key = `${input.action}:${input.propertyId}:${input.correlationId}:${input.workerRunId}`;
      if (auditKeys.has(key)) return;
      auditKeys.add(key);
      auditWrites += 1;
    },
    ...overrides,
  };

  return {
    repository,
    get addressWrites() {
      return addressWrites;
    },
    get completions() {
      return completions;
    },
    get auditWrites() {
      return auditWrites;
    },
    get validations() {
      return validations;
    },
  };
}

const event = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  pipelineRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  leadId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  propertyId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  submittedAddress: "12 Birch St, Trenton, NJ",
  attempt: 1,
};

test("exact attempt-bound prefetch completes this worker without repeating validation side effects", async () => {
  const findExactAssessmentPrefetch = vi.fn(async () => ({
    canonicalAddress: "18 HARBOR VIEW DR, RED BANK, NJ 07701",
    latitude: 40.3501,
    longitude: -74.0642,
  }));
  const startValidating = vi.fn();
  const beginProviderRequest = vi.fn(async () => ({providerRequestId: "unused"}));
  const validateAddress = vi.fn(async () => evidence(VALIDATED_ADDRESS));
  const claimCanonicalAddress = vi.fn();
  const recordPropertyAddress = vi.fn(async () => true);
  const publishDiscoveryRequested = vi.fn();
  const createReviewTask = vi.fn();
  const writeAudit = vi.fn();
  const state = makeRepository({
    findExactAssessmentPrefetch,
    startValidating,
    beginProviderRequest,
    validateAddress,
    claimCanonicalAddress,
    recordPropertyAddress,
    publishDiscoveryRequested,
    createReviewTask,
    writeAudit,
  });

  const result = await runAddressValidation(event, state.repository);

  expect(findExactAssessmentPrefetch).toHaveBeenCalledWith({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  });
  expect(result).toEqual({
    workerRunId: `address-validation-worker:${event.pipelineRunId}:1`,
    outcome: "already_prefetched",
  });
  expect(state.completions).toBe(1);
  expect(startValidating).not.toHaveBeenCalled();
  expect(beginProviderRequest).not.toHaveBeenCalled();
  expect(validateAddress).not.toHaveBeenCalled();
  expect(claimCanonicalAddress).not.toHaveBeenCalled();
  expect(recordPropertyAddress).not.toHaveBeenCalled();
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(createReviewTask).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
});

test("missing exact-scope prefetch keeps deferred and manual work on the provider path", async () => {
  const findExactAssessmentPrefetch = vi.fn(async () => null);
  const validateAddress = vi.fn(async () => evidence(VALIDATED_ADDRESS));
  const state = makeRepository({findExactAssessmentPrefetch, validateAddress});

  const result = await runAddressValidation(
    {...event, googlePlaceId: undefined},
    state.repository,
  );

  expect(result.outcome).toBe("discovery_requested");
  expect(validateAddress).toHaveBeenCalledTimes(1);
  expect(state.addressWrites).toBe(1);
});

test("normal validation records one observation and publishes discovery", async () => {
  const publishDiscoveryRequested = vi.fn();
  const recordPropertyAddress = vi.fn(async () => true);
  const state = makeRepository({ publishDiscoveryRequested, recordPropertyAddress });

  const result = await runAddressValidation(event, state.repository);

  expect(recordPropertyAddress).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: event.propertyId,
      workerRunId: `address-validation-worker:${event.pipelineRunId}:1`,
    }),
  );
  expect(publishDiscoveryRequested).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: event.propertyId,
      canonicalAddress: VALIDATED_ADDRESS.canonicalAddress,
    }),
  );
  expect(result.outcome).toBe("discovery_requested");
  expect(state.completions).toBe(1);
  expect(state.auditWrites).toBe(1);
});

test("provider lineage is opened before Census and completed for the worker attempt", async () => {
  const callOrder: string[] = [];
  const beginProviderRequest = vi.fn(async (input) => {
    callOrder.push("requested");
    return {
      providerRequestId: `provider-request-${input.attempt}`,
    };
  });
  const validateAddress = vi.fn(async () => {
    callOrder.push("execute");
    return evidence(VALIDATED_ADDRESS);
  });
  const completeProviderRequest = vi.fn(async () => {
    callOrder.push("succeeded");
  });
  const state = makeRepository({
    beginProviderRequest,
    validateAddress,
    completeProviderRequest,
  });

  await runAddressValidation({ ...event, attempt: 2 }, state.repository);

  expect(beginProviderRequest).toHaveBeenCalledWith({
    pipelineRunId: event.pipelineRunId,
    companyId: "99999999-9999-4999-8999-999999999999",
    workerRunId: `address-validation-worker:${event.pipelineRunId}:2`,
    attempt: 2,
  });
  expect(validateAddress).toHaveBeenCalledWith(
    expect.objectContaining({ attempt: 2 }),
  );
  expect(completeProviderRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      providerRequestId: "provider-request-2",
      companyId: "99999999-9999-4999-8999-999999999999",
      evidence: evidence(VALIDATED_ADDRESS),
    }),
  );
  expect(callOrder).toEqual(["requested", "execute", "succeeded"]);
});

test("failed Census calls close the provider request with safe metadata", async () => {
  const failProviderRequest = vi.fn();
  const state = makeRepository({
    validateAddress: async () => {
      throw new Error("secret upstream hostname and raw response");
    },
    failProviderRequest,
  });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "secret upstream hostname and raw response",
  );

  expect(failProviderRequest).toHaveBeenCalledWith({
    providerRequestId: "provider-request-1",
    companyId: "99999999-9999-4999-8999-999999999999",
    failureCode: "provider_execution_failed",
    failureMetadata: {
      capability: "address.validate",
      attempt: 1,
    },
  });
  expect(JSON.stringify(failProviderRequest.mock.calls)).not.toContain(
    "secret upstream",
  );
});

test("canonical address claiming is delegated to the transactional repository boundary", async () => {
  const claimCanonicalAddress = vi.fn(async () => ({
    outcome: "discovery_requested" as const,
    observationPropertyId: event.propertyId,
    canonicalPropertyId: event.propertyId,
    candidatePropertyIds: [],
    sideEffectsApplied: true,
  }));
  const state = makeRepository({ claimCanonicalAddress });

  await runAddressValidation(event, state.repository);

  expect(claimCanonicalAddress).toHaveBeenCalledWith({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
    companyId: "99999999-9999-4999-8999-999999999999",
    workerRunId: `address-validation-worker:${event.pipelineRunId}:1`,
    providerRequestId: "provider-request-1",
    submittedAddress: event.submittedAddress,
    result: VALIDATED_ADDRESS,
    attempt: 1,
  });
});

test("low confidence records the observation and creates review instead of discovery", async () => {
  const lowConfidence = { ...VALIDATED_ADDRESS, canonicalAddress: null, confidence: 0 };
  const createReviewTask = vi.fn();
  const publishDiscoveryRequested = vi.fn();
  const state = makeRepository({
    validateAddress: async () => evidence(lowConfidence),
    createReviewTask,
    publishDiscoveryRequested,
  });

  const result = await runAddressValidation(event, state.repository);

  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: event.propertyId,
      reason: "low_address_confidence",
      workerRunId: `address-validation-worker:${event.pipelineRunId}:1`,
    }),
  );
  expect(state.addressWrites).toBe(1);
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(result.outcome).toBe("review_required");
});

test("exact matches without an explicit NJ state require review and never start discovery", async () => {
  const outOfStateExactMatch = {
    ...VALIDATED_ADDRESS,
    canonicalAddress: "12 BIRCH ST, PHILADELPHIA, PA, 19103",
    municipality: "PHILADELPHIA",
    stateCode: null,
  };
  const createReviewTask = vi.fn();
  const updateCanonicalPropertyFields = vi.fn();
  const publishDiscoveryRequested = vi.fn();
  const state = makeRepository({
    validateAddress: async () => evidence(outOfStateExactMatch),
    createReviewTask,
    updateCanonicalPropertyFields,
    publishDiscoveryRequested,
  });

  const result = await runAddressValidation(event, state.repository);

  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: event.propertyId,
      reason: "low_address_confidence",
    }),
  );
  expect(updateCanonicalPropertyFields).not.toHaveBeenCalled();
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(result.outcome).toBe("review_required");
});

test("a retried address attempt preserves its lineage on the next review task", async () => {
  const lowConfidence = {
    ...VALIDATED_ADDRESS,
    canonicalAddress: null,
    confidence: 0,
  };
  const createReviewTask = vi.fn();
  const state = makeRepository({
    validateAddress: async () => evidence(lowConfidence),
    createReviewTask,
  });

  await runAddressValidation({ ...event, attempt: 2 }, state.repository);

  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({
      attempt: 2,
      workerRunId: `address-validation-worker:${event.pipelineRunId}:2`,
    }),
  );
});

test("duplicate match attaches the observation to canonical property and completes duplicate pipeline", async () => {
  const canonicalPropertyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const recordPropertyAddress = vi.fn(async () => true);
  const mergeIntoCanonicalProperty = vi.fn();
  const publishDiscoveryRequested = vi.fn();
  const state = makeRepository({
    findDuplicateCandidates: async () => [{ propertyId: canonicalPropertyId }],
    recordPropertyAddress,
    mergeIntoCanonicalProperty,
    publishDiscoveryRequested,
  });

  const result = await runAddressValidation(event, state.repository);

  expect(recordPropertyAddress).toHaveBeenCalledWith(
    expect.objectContaining({ propertyId: canonicalPropertyId }),
  );
  expect(mergeIntoCanonicalProperty).toHaveBeenCalledWith({
    placeholderPropertyId: event.propertyId,
    canonicalPropertyId,
    leadId: event.leadId,
    pipelineRunId: event.pipelineRunId,
    companyId: "99999999-9999-4999-8999-999999999999",
  });
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(result.outcome).toBe("merged");
});

test("duplicate roof-estimate lead continues discovery on the canonical property", async () => {
  const canonicalPropertyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const continueRoofEstimateAfterMerge = vi.fn(async () => true);
  const publishDiscoveryRequested = vi.fn();
  const state = makeRepository({
    findDuplicateCandidates: async () => [{ propertyId: canonicalPropertyId }],
    continueRoofEstimateAfterMerge,
    publishDiscoveryRequested,
  });

  const result = await runAddressValidation(event, state.repository);

  expect(continueRoofEstimateAfterMerge).toHaveBeenCalledWith({
    leadId: event.leadId,
    pipelineRunId: event.pipelineRunId,
    companyId: "99999999-9999-4999-8999-999999999999",
    canonicalPropertyId,
  });
  expect(publishDiscoveryRequested).toHaveBeenCalledWith(
    expect.objectContaining({
      leadId: event.leadId,
      pipelineRunId: event.pipelineRunId,
      propertyId: canonicalPropertyId,
    }),
  );
  expect(result.outcome).toBe("discovery_requested");
});

test("completed replay returns before provider calls or writes", async () => {
  const validateAddress = vi.fn(async () => evidence(VALIDATED_ADDRESS));
  const recordPropertyAddress = vi.fn(async () => true);
  const state = makeRepository({ validateAddress, recordPropertyAddress });

  await runAddressValidation(event, state.repository);
  const result = await runAddressValidation(event, state.repository);

  expect(result.outcome).toBe("already_completed");
  expect(validateAddress).toHaveBeenCalledTimes(1);
  expect(recordPropertyAddress).toHaveBeenCalledTimes(1);
  expect(state.completions).toBe(1);
  expect(state.auditWrites).toBe(1);
});

test("concurrent duplicate delivery records one address observation", async () => {
  const state = makeRepository();

  const [first, second] = await Promise.all([
    runAddressValidation(event, state.repository),
    runAddressValidation(event, state.repository),
  ]);

  expect(state.addressWrites).toBe(1);
  expect(first.outcome).toBe("discovery_requested");
  expect(second.outcome).toBe("discovery_requested");
  expect(state.completions).toBe(1);
  expect(state.auditWrites).toBe(1);
});

test("replay resumes downstream work when the address observation already exists", async () => {
  const publishDiscoveryRequested = vi
    .fn()
    .mockRejectedValueOnce(new Error("outbox unavailable"))
    .mockResolvedValue(undefined);
  const state = makeRepository({ publishDiscoveryRequested });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "outbox unavailable",
  );
  const result = await runAddressValidation(event, state.repository);

  expect(state.addressWrites).toBe(1);
  expect(publishDiscoveryRequested).toHaveBeenCalledTimes(2);
  expect(result.outcome).toBe("discovery_requested");
  expect(state.completions).toBe(1);
  expect(state.auditWrites).toBe(1);
});

test("replay reuses the first address evidence when Census later returns a different match", async () => {
  const laterNoMatch = {
    ...VALIDATED_ADDRESS,
    canonicalAddress: null,
    latitude: null,
    longitude: null,
    municipality: null,
    stateCode: null,
    zip: null,
    matchMethod: "no_match" as const,
    confidence: 0,
  };
  const validateAddress = vi
    .fn()
    .mockResolvedValueOnce(evidence(VALIDATED_ADDRESS))
    .mockResolvedValueOnce(evidence(laterNoMatch));
  const publishDiscoveryRequested = vi
    .fn()
    .mockRejectedValueOnce(new Error("outbox unavailable"))
    .mockResolvedValue(undefined);
  const createReviewTask = vi.fn();
  const state = makeRepository({
    validateAddress,
    publishDiscoveryRequested,
    createReviewTask,
  });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "outbox unavailable",
  );
  const replay = await runAddressValidation(event, state.repository);

  expect(validateAddress).toHaveBeenCalledTimes(1);
  expect(createReviewTask).not.toHaveBeenCalled();
  expect(publishDiscoveryRequested).toHaveBeenCalledTimes(2);
  expect(replay.outcome).toBe("discovery_requested");
});

test("replay reuses the first duplicate decision when candidates later change", async () => {
  const canonicalPropertyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const findDuplicateCandidates = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ propertyId: canonicalPropertyId }]);
  const publishDiscoveryRequested = vi
    .fn()
    .mockRejectedValueOnce(new Error("outbox unavailable"))
    .mockResolvedValue(undefined);
  const mergeIntoCanonicalProperty = vi.fn();
  const state = makeRepository({
    findDuplicateCandidates,
    publishDiscoveryRequested,
    mergeIntoCanonicalProperty,
  });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "outbox unavailable",
  );
  const replay = await runAddressValidation(event, state.repository);

  expect(findDuplicateCandidates).toHaveBeenCalledTimes(1);
  expect(mergeIntoCanonicalProperty).not.toHaveBeenCalled();
  expect(publishDiscoveryRequested).toHaveBeenCalledTimes(2);
  expect(replay.outcome).toBe("discovery_requested");
});

test("audit failure leaves the run replayable until the audit succeeds", async () => {
  const writeAudit = vi
    .fn()
    .mockRejectedValueOnce(new Error("audit unavailable"))
    .mockResolvedValue(undefined);
  const state = makeRepository({ writeAudit });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "audit unavailable",
  );
  const result = await runAddressValidation(event, state.repository);

  expect(writeAudit).toHaveBeenCalledTimes(2);
  expect(result.outcome).toBe("discovery_requested");
  expect(state.completions).toBe(1);
});

test("distinct worker attempts each retain their own audit entry", async () => {
  const state = makeRepository();

  await runAddressValidation(event, state.repository);
  await runAddressValidation({ ...event, attempt: 2 }, state.repository);

  expect(state.auditWrites).toBe(2);
  expect(state.addressWrites).toBe(2);
});

test("ambiguous duplicate candidates create one review observation without publish or merge", async () => {
  const createReviewTask = vi.fn();
  const publishDiscoveryRequested = vi.fn();
  const mergeIntoCanonicalProperty = vi.fn();
  const state = makeRepository({
    findDuplicateCandidates: async () => [
      { propertyId: "11111111-1111-4111-8111-111111111111" },
      { propertyId: "22222222-2222-4222-8222-222222222222" },
    ],
    createReviewTask,
    publishDiscoveryRequested,
    mergeIntoCanonicalProperty,
  });

  const result = await runAddressValidation(event, state.repository);

  expect(state.addressWrites).toBe(1);
  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "duplicate_candidates" }),
  );
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(mergeIntoCanonicalProperty).not.toHaveBeenCalled();
  expect(result.outcome).toBe("review_required");
});

test("cross-company event relationships are rejected before provider work", async () => {
  const validateAddress = vi.fn(async () => evidence(VALIDATED_ADDRESS));
  const recordPropertyAddress = vi.fn(async () => true);
  const state = makeRepository({
    assertEventScope: async () => {
      throw new Error("Address-validation scope mismatch");
    },
    validateAddress,
    recordPropertyAddress,
  });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "Address-validation scope mismatch",
  );
  expect(validateAddress).not.toHaveBeenCalled();
  expect(recordPropertyAddress).not.toHaveBeenCalled();
});

test("cross-company canonical match is rejected before merge", async () => {
  const canonicalPropertyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const mergeIntoCanonicalProperty = vi.fn();
  const state = makeRepository({
    findDuplicateCandidates: async () => [{ propertyId: canonicalPropertyId }],
    recordPropertyAddress: async ({ propertyId }) => {
      if (propertyId === canonicalPropertyId) {
        throw new Error("Address-validation scope mismatch");
      }
      return true;
    },
    mergeIntoCanonicalProperty,
  });

  await expect(runAddressValidation(event, state.repository)).rejects.toThrow(
    "Address-validation scope mismatch",
  );
  expect(mergeIntoCanonicalProperty).not.toHaveBeenCalled();
});

test("existing provider request still backfills its missing source evidence", async () => {
  const sourceUpsert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    from(table: string) {
      if (table === "provider_requests") {
        return {
          insert() {
            return {
              select() {
                return {
                  single: async () => ({
                    data: null,
                    error: { code: "23505" },
                  }),
                };
              },
            };
          },
          select() {
            const chain = {
              eq() {
                return chain;
              },
              single: async () => ({
                data: {
                  id: "provider-request-1",
                  requested_at: "2026-07-29T11:59:59.000Z",
                  completed_at: "2026-07-29T12:00:00.000Z",
                },
                error: null,
              }),
            };
            return chain;
          },
        };
      }
      if (table === "source_records") return { upsert: sourceUpsert };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const repository = new SupabaseAddressValidationWorkerRepository(
    client as never,
  );

  const result = await repository.recordProviderEvidence({
    pipelineRunId: event.pipelineRunId,
    companyId: "99999999-9999-4999-8999-999999999999",
    evidence: evidence(VALIDATED_ADDRESS),
  });

  expect(result).toEqual({ providerRequestId: "provider-request-1" });
  expect(sourceUpsert).toHaveBeenCalledWith(
    expect.objectContaining({
      company_id: "99999999-9999-4999-8999-999999999999",
      source_identifier:
        "99999999-9999-4999-8999-999999999999:12 BIRCH ST, TRENTON, NJ, 08611",
      retrieved_at: "2026-07-29T12:00:00.000Z",
    }),
    {
      onConflict: "provider,source_identifier,retrieved_at",
      ignoreDuplicates: true,
    },
  );
});

test("Supabase prefetch lookup requires exact pipeline and attempt provenance scope", async () => {
  const companyId = "99999999-9999-4999-8999-999999999999";
  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const startedEvent = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "roof/assessment.started",
    schemaVersion: 1,
    correlationId: event.correlationId,
    leadId: event.leadId,
    propertyId: event.propertyId,
    pipelineRunId: event.pipelineRunId,
    occurredAt: "2026-08-28T12:00:00.000Z",
    idempotencyKey: `roof/assessment.started:${assessmentId}`,
    data: {
      assessmentId,
      entryPoint: "main-home",
      presentationKey: "all-season-main",
    },
  };
  const calls: Array<[string, string, unknown?]> = [];
  const pipelineQuery = {
    select(columns: string) {
      calls.push(["pipeline_runs", "select", columns]);
      return pipelineQuery;
    },
    eq(column: string, value: unknown) {
      calls.push(["pipeline_runs", column, value]);
      return pipelineQuery;
    },
    maybeSingle: async () => ({data: {company_id: companyId}, error: null}),
  };
  const eventQuery = {
    select(columns: string) {
      calls.push(["domain_events", "select", columns]);
      return eventQuery;
    },
    eq(column: string, value: unknown) {
      calls.push(["domain_events", column, value]);
      return eventQuery;
    },
    maybeSingle: async () => ({
      data: {
        id: startedEvent.id,
        correlation_id: startedEvent.correlationId,
        idempotency_key: startedEvent.idempotencyKey,
        payload: startedEvent,
      },
      error: null,
    }),
  };
  const addressQuery = {
    select(columns: string) {
      calls.push(["property_addresses", "select", columns]);
      return addressQuery;
    },
    eq(column: string, value: unknown) {
      calls.push(["property_addresses", column, value]);
      return addressQuery;
    },
    gte(column: string, value: unknown) {
      calls.push(["property_addresses", column, value]);
      return addressQuery;
    },
    not(column: string, operator: string, value: unknown) {
      calls.push(["property_addresses", `${column}.${operator}`, value]);
      return addressQuery;
    },
    order(column: string, options: unknown) {
      calls.push(["property_addresses", `order.${column}`, options]);
      return addressQuery;
    },
    limit(value: number) {
      calls.push(["property_addresses", "limit", value]);
      return addressQuery;
    },
    maybeSingle: async () => ({
      data: {
        canonical_address: "18 HARBOR VIEW DR, RED BANK, NJ 07701",
        latitude: 40.3501,
        longitude: -74.0642,
      },
      error: null,
    }),
  };
  const client = {
    from(table: string) {
      if (table === "pipeline_runs") return pipelineQuery;
      if (table === "domain_events") return eventQuery;
      if (table === "property_addresses") return addressQuery;
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const repository = new SupabaseAddressValidationWorkerRepository(client as never);

  await expect(repository.findExactAssessmentPrefetch({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  })).resolves.toEqual({
    canonicalAddress: "18 HARBOR VIEW DR, RED BANK, NJ 07701",
    latitude: 40.3501,
    longitude: -74.0642,
  });

  expect(calls).toContainEqual(["pipeline_runs", "id", event.pipelineRunId]);
  expect(calls).toContainEqual(["pipeline_runs", "lead_id", event.leadId]);
  expect(calls).toContainEqual(["pipeline_runs", "property_id", event.propertyId]);
  expect(calls).toContainEqual(["domain_events", "pipeline_run_id", event.pipelineRunId]);
  expect(calls).toContainEqual(["domain_events", "event_name", "roof/assessment.started"]);
  expect(calls).toContainEqual(["property_addresses", "company_id", companyId]);
  expect(calls).toContainEqual(["property_addresses", "property_id", event.propertyId]);
  expect(calls).toContainEqual([
    "property_addresses",
    "roof_assessment_access_attempts.company_id",
    companyId,
  ]);
  expect(calls).toContainEqual([
    "property_addresses",
    "roof_assessment_access_attempts.lead_id",
    event.leadId,
  ]);
  expect(calls).toContainEqual([
    "property_addresses",
    "roof_assessment_access_attempts.property_id",
    event.propertyId,
  ]);
  expect(calls).toContainEqual([
    "property_addresses",
    "roof_assessment_access_attempts.assessment_id",
    assessmentId,
  ]);
  expect(calls).toContainEqual(["property_addresses", "match_method", "exact_single_match"]);
  expect(calls).toContainEqual(["property_addresses", "state_code", "NJ"]);
  expect(calls).toContainEqual(["property_addresses", "confidence", 95]);
  expect(calls).toContainEqual([
    "property_addresses",
    "assessment_access_attempt_id.is",
    null,
  ]);
  expect(calls).toContainEqual(["property_addresses", "canonical_address.is", null]);
  expect(calls).toContainEqual(["property_addresses", "latitude.is", null]);
  expect(calls).toContainEqual(["property_addresses", "longitude.is", null]);
  expect(calls.find(([table, action, value]) =>
    table === "property_addresses"
    && action === "select"
    && String(value).includes("roof_assessment_access_attempts!")
    && String(value).includes("!inner")
  )).toBeTruthy();
  expect(JSON.stringify(calls)).not.toContain("google_place_id");
});

test("same-scope pipeline cannot reuse evidence from another pipeline's assessment", async () => {
  const companyId = "99999999-9999-4999-8999-999999999999";
  const pipelineAId = event.pipelineRunId;
  const pipelineBId = "abababab-abab-4bab-8bab-abababababab";
  const assessmentAId = "11111111-1111-4111-8111-111111111111";
  const assessmentBId = "22222222-2222-4222-8222-222222222222";
  const startedEventB = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "roof/assessment.started",
    schemaVersion: 1,
    correlationId: event.correlationId,
    leadId: event.leadId,
    propertyId: event.propertyId,
    pipelineRunId: pipelineBId,
    occurredAt: "2026-08-28T12:00:00.000Z",
    idempotencyKey: `roof/assessment.started:${assessmentBId}`,
    data: {
      assessmentId: assessmentBId,
      entryPoint: "main-home",
      presentationKey: "all-season-main",
    },
  };

  function queryFor(table: string) {
    const filters = new Map<string, unknown>();
    const query = {
      select() { return query; },
      eq(column: string, value: unknown) {
        filters.set(column, value);
        return query;
      },
      gte() { return query; },
      not() { return query; },
      order() { return query; },
      limit() { return query; },
      maybeSingle: async () => {
        if (table === "pipeline_runs") {
          const pipelineId = filters.get("id");
          return {
            data: [pipelineAId, pipelineBId].includes(String(pipelineId))
              ? {company_id: companyId}
              : null,
            error: null,
          };
        }
        if (table === "domain_events") {
          return {
            data: filters.get("pipeline_run_id") === pipelineBId
              ? {
                  id: startedEventB.id,
                  correlation_id: startedEventB.correlationId,
                  idempotency_key: startedEventB.idempotencyKey,
                  payload: startedEventB,
                }
              : null,
            error: null,
          };
        }
        if (table === "property_addresses") {
          const assessmentFilter = filters.get(
            "roof_assessment_access_attempts.assessment_id",
          );
          return {
            data: assessmentFilter === undefined || assessmentFilter === assessmentAId
              ? {
                  canonical_address: "18 HARBOR VIEW DR, RED BANK, NJ 07701",
                  latitude: 40.3501,
                  longitude: -74.0642,
                }
              : null,
            error: null,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    return query;
  }

  const client = {from: (table: string) => queryFor(table)};
  const supabaseRepository = new SupabaseAddressValidationWorkerRepository(
    client as never,
  );
  const findExactAssessmentPrefetch = vi.fn((input) =>
    supabaseRepository.findExactAssessmentPrefetch(input)
  );
  const validateAddress = vi.fn(async () => evidence(VALIDATED_ADDRESS));
  const state = makeRepository({findExactAssessmentPrefetch, validateAddress});

  await expect(findExactAssessmentPrefetch({
    pipelineRunId: pipelineBId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  })).resolves.toBeNull();
  const result = await runAddressValidation(
    {...event, pipelineRunId: pipelineBId},
    state.repository,
  );

  expect(result.outcome).toBe("discovery_requested");
  expect(validateAddress).toHaveBeenCalledTimes(1);
});

test("Supabase prefetch lookup ignores foreign pipeline scope before reading evidence", async () => {
  const addressLookup = vi.fn();
  const pipelineQuery = {
    select() { return pipelineQuery; },
    eq() { return pipelineQuery; },
    maybeSingle: async () => ({data: null, error: null}),
  };
  const client = {
    from(table: string) {
      if (table === "pipeline_runs") return pipelineQuery;
      addressLookup(table);
      throw new Error("Foreign evidence must not be queried");
    },
  };
  const repository = new SupabaseAddressValidationWorkerRepository(client as never);

  await expect(repository.findExactAssessmentPrefetch({
    pipelineRunId: event.pipelineRunId,
    leadId: event.leadId,
    propertyId: event.propertyId,
  })).resolves.toBeNull();
  expect(addressLookup).not.toHaveBeenCalled();
});

test("Supabase scope guard rejects a cross-company lead relationship", async () => {
  const rows = {
    pipeline_runs: {
      company_id: "99999999-9999-4999-8999-999999999999",
      lead_id: event.leadId,
      property_id: event.propertyId,
    },
    leads: {
      company_id: "11111111-1111-4111-8111-111111111111",
      property_id: event.propertyId,
    },
    properties: {
      company_id: "99999999-9999-4999-8999-999999999999",
    },
  };
  const client = {
    from(table: keyof typeof rows) {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            single: async () => ({ data: rows[table], error: null }),
          };
          return chain;
        },
      };
    },
  };
  const repository = new SupabaseAddressValidationWorkerRepository(
    client as never,
  );

  await expect(
    repository.assertEventScope({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
    }),
  ).rejects.toThrow("Address-validation scope mismatch");
});

test("Supabase scope guard accepts an idempotent replay after a same-company merge", async () => {
  const companyId = "99999999-9999-4999-8999-999999999999";
  const canonicalPropertyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const rows = {
    pipeline_runs: {
      company_id: companyId,
      lead_id: event.leadId,
      property_id: canonicalPropertyId,
    },
    leads: {
      company_id: companyId,
      property_id: canonicalPropertyId,
    },
    properties: {
      company_id: companyId,
      merged_into_property_id: canonicalPropertyId,
    },
  };
  const client = {
    from(table: keyof typeof rows) {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            single: async () => ({ data: rows[table], error: null }),
          };
          return chain;
        },
      };
    },
  };
  const repository = new SupabaseAddressValidationWorkerRepository(
    client as never,
  );

  await expect(
    repository.assertEventScope({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
    }),
  ).resolves.toEqual({ companyId });
});
