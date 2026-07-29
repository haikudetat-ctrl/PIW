import { expect, test, vi } from "vitest";
import type { AddressValidationResult } from "@/domain/property-identity";
import type { ProviderResult } from "@/modules/providers/contracts";
import {
  runAddressValidation,
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
  let addressWrites = 0;
  let completions = 0;
  let auditWrites = 0;
  let validations = 0;

  const repository: AddressValidationWorkerRepository = {
    async upsertWorkerRunQueued({ idempotencyKey }) {
      const existing = workerRuns.get(idempotencyKey);
      if (existing) return { ...existing };
      const record: WorkerRunRecord = { id: idempotencyKey, status: "queued" };
      workerRuns.set(idempotencyKey, record);
      return { ...record };
    },
    async markWorkerRunCompleted(workerRunId) {
      completions += 1;
      const record = workerRuns.get(workerRunId);
      if (record) record.status = "completed";
    },
    async startValidating() {},
    async validateAddress() {
      validations += 1;
      return evidence(VALIDATED_ADDRESS);
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
    async publishDiscoveryRequested() {},
    async writeAudit() {
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
    }),
  );
  expect(state.addressWrites).toBe(1);
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(result.outcome).toBe("review_required");
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
  });
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(result.outcome).toBe("merged");
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
  expect([first.outcome, second.outcome]).toContain("already_processed");
  expect(state.completions).toBe(1);
  expect(state.auditWrites).toBe(1);
});
