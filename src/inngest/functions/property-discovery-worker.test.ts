import { expect, test, vi } from "vitest";
import type { ParcelData } from "@/domain/property-identity";
import type { ProviderResult } from "@/modules/providers/contracts";
import {
  runPropertyDiscovery,
  SupabasePropertyDiscoveryWorkerRepository,
  type PropertyDiscoveryWorkerRepository,
  type WorkerRunRecord,
} from "./property-discovery-worker";

const RESIDENTIAL_PARCEL: ParcelData = {
  block: "101",
  lot: "5",
  qualifier: null,
  pamsPin: "0101_5_",
  gisPin: null,
  municipalityCode: "0101",
  municipalityName: "TRENTON CITY",
  county: "MERCER",
  propertyClass: "2",
  acreage: 0.25,
  yearBuilt: 1975,
  landValue: 50000.125,
  improvementValue: 150000.505,
  netValue: 200000.63,
  propertyLocation: "12 BIRCH ST",
  streetAddress: "12 BIRCH ST",
  buildingDescription: null,
  landDescription: null,
  dwellingUnits: 1,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-74.761, 40.221],
        [-74.759, 40.221],
        [-74.759, 40.219],
        [-74.761, 40.221],
      ],
    ],
  },
};

function evidence(
  value: ParcelData[] = [RESIDENTIAL_PARCEL],
): ProviderResult<ParcelData[]> {
  return {
    value,
    provider: "njgin_parcels_composite",
    sourceIdentifier: "0101-101-5",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    estimatedCostMicros: 0,
  };
}

function makeRepository(
  overrides: Partial<PropertyDiscoveryWorkerRepository> = {},
) {
  const workerRuns = new Map<string, WorkerRunRecord>();
  const parcelByProperty = new Map<string, string>();
  const structureProperties = new Set<string>();
  const auditKeys = new Set<string>();
  let completions = 0;
  let audits = 0;
  let lookups = 0;
  let parcelWrites = 0;
  let structureWrites = 0;

  const repository: PropertyDiscoveryWorkerRepository = {
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
      record.status = "completed";
      completions += 1;
    },
    async startEnriching() {},
    async lookupParcels() {
      lookups += 1;
      return evidence();
    },
    async recordProviderEvidence() {
      return { providerRequestId: "provider-request-1" };
    },
    async recordParcel({ propertyId }) {
      const existing = parcelByProperty.get(propertyId);
      if (existing) return { parcelId: existing };
      const parcelId = `parcel-${propertyId}`;
      parcelByProperty.set(propertyId, parcelId);
      parcelWrites += 1;
      return { parcelId };
    },
    async recordStructure({ propertyId }) {
      if (structureProperties.has(propertyId)) return;
      structureProperties.add(propertyId);
      structureWrites += 1;
    },
    async resolveProperty() {},
    async createReviewTask() {},
    async completePipelineRun() {},
    async writeAudit(input) {
      const key = `${input.action}:${input.workerRunId}`;
      if (auditKeys.has(key)) return;
      auditKeys.add(key);
      audits += 1;
    },
    ...overrides,
  };

  return {
    repository,
    get completions() {
      return completions;
    },
    get audits() {
      return audits;
    },
    get lookups() {
      return lookups;
    },
    get parcelWrites() {
      return parcelWrites;
    },
    get structureWrites() {
      return structureWrites;
    },
  };
}

const event = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  pipelineRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  leadId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  propertyId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  canonicalAddress: "12 BIRCH ST, TRENTON, NJ",
  latitude: 40.22,
  longitude: -74.76,
  attempt: 1,
};

test("a residential parcel resolves the property and completes its pipeline", async () => {
  const recordParcel = vi.fn(async () => ({ parcelId: "parcel-1" }));
  const recordStructure = vi.fn();
  const resolveProperty = vi.fn();
  const completePipelineRun = vi.fn();
  const state = makeRepository({
    recordParcel,
    recordStructure,
    resolveProperty,
    completePipelineRun,
  });

  const result = await runPropertyDiscovery(event, state.repository);

  expect(recordParcel).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: event.propertyId,
      parcel: RESIDENTIAL_PARCEL,
      providerRequestId: "provider-request-1",
    }),
  );
  expect(recordStructure).toHaveBeenCalledWith(
    expect.objectContaining({
      propertyId: event.propertyId,
      parcelId: "parcel-1",
    }),
  );
  expect(resolveProperty).toHaveBeenCalledOnce();
  expect(completePipelineRun).toHaveBeenCalledOnce();
  expect(result.outcome).toBe("resolved");
  expect(state.completions).toBe(1);
  expect(state.audits).toBe(1);
});

test("no parcel candidates create review instead of resolving", async () => {
  const createReviewTask = vi.fn();
  const resolveProperty = vi.fn();
  const completePipelineRun = vi.fn();
  const state = makeRepository({
    lookupParcels: async () => evidence([]),
    createReviewTask,
    resolveProperty,
    completePipelineRun,
  });

  const result = await runPropertyDiscovery(event, state.repository);

  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: "unsupported_property_type",
      candidateData: { candidates: [] },
    }),
  );
  expect(resolveProperty).not.toHaveBeenCalled();
  expect(completePipelineRun).not.toHaveBeenCalled();
  expect(result.outcome).toBe("review_required");
});

test("completed replay returns before provider calls or writes", async () => {
  const state = makeRepository();

  await runPropertyDiscovery(event, state.repository);
  const replay = await runPropertyDiscovery(event, state.repository);

  expect(replay.outcome).toBe("already_completed");
  expect(state.lookups).toBe(1);
  expect(state.parcelWrites).toBe(1);
  expect(state.structureWrites).toBe(1);
  expect(state.completions).toBe(1);
  expect(state.audits).toBe(1);
});

test("concurrent duplicate delivery records one primary parcel and structure", async () => {
  const state = makeRepository();

  const results = await Promise.all([
    runPropertyDiscovery(event, state.repository),
    runPropertyDiscovery(event, state.repository),
  ]);

  expect(results.map((result) => result.outcome)).toEqual([
    "resolved",
    "resolved",
  ]);
  expect(state.parcelWrites).toBe(1);
  expect(state.structureWrites).toBe(1);
  expect(state.completions).toBe(1);
  expect(state.audits).toBe(1);
});

test("replay resumes after a downstream failure without duplicating current state", async () => {
  const completePipelineRun = vi
    .fn()
    .mockRejectedValueOnce(new Error("pipeline unavailable"))
    .mockResolvedValue(undefined);
  const state = makeRepository({ completePipelineRun });

  await expect(runPropertyDiscovery(event, state.repository)).rejects.toThrow(
    "pipeline unavailable",
  );
  const result = await runPropertyDiscovery(event, state.repository);

  expect(state.parcelWrites).toBe(1);
  expect(state.structureWrites).toBe(1);
  expect(completePipelineRun).toHaveBeenCalledTimes(2);
  expect(result.outcome).toBe("resolved");
  expect(state.completions).toBe(1);
  expect(state.audits).toBe(1);
});

test("audit failure leaves the run replayable until the audit succeeds", async () => {
  const writeAudit = vi
    .fn()
    .mockRejectedValueOnce(new Error("audit unavailable"))
    .mockResolvedValue(undefined);
  const state = makeRepository({ writeAudit });

  await expect(runPropertyDiscovery(event, state.repository)).rejects.toThrow(
    "audit unavailable",
  );
  const result = await runPropertyDiscovery(event, state.repository);

  expect(writeAudit).toHaveBeenCalledTimes(2);
  expect(result.outcome).toBe("resolved");
  expect(state.completions).toBe(1);
});

test("distinct worker attempts retain separate audit entries", async () => {
  const state = makeRepository();

  await runPropertyDiscovery(event, state.repository);
  await runPropertyDiscovery({ ...event, attempt: 2 }, state.repository);

  expect(state.audits).toBe(2);
  expect(state.completions).toBe(2);
});

test("cross-company event relationships are rejected before provider work", async () => {
  const lookupParcels = vi.fn(async () => evidence());
  const state = makeRepository({
    assertEventScope: async () => {
      throw new Error("Property-discovery scope mismatch");
    },
    lookupParcels,
  });

  await expect(runPropertyDiscovery(event, state.repository)).rejects.toThrow(
    "Property-discovery scope mismatch",
  );
  expect(lookupParcels).not.toHaveBeenCalled();
  expect(state.parcelWrites).toBe(0);
});

test("parcel writes convert every provider dollar value to integer cents", async () => {
  let insertedParcel: Record<string, unknown> | undefined;
  const client = {
    from(table: string) {
      if (table !== "parcels") throw new Error(`Unexpected table: ${table}`);
      return {
        insert(value: Record<string, unknown>) {
          insertedParcel = value;
          return {
            select() {
              return {
                single: async () => ({
                  data: { id: "parcel-1" },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const repository = new SupabasePropertyDiscoveryWorkerRepository(
    client as never,
  );

  const result = await repository.recordParcel({
    propertyId: event.propertyId,
    companyId: "99999999-9999-4999-8999-999999999999",
    parcel: RESIDENTIAL_PARCEL,
    providerRequestId: "provider-request-1",
  });

  expect(result).toEqual({ parcelId: "parcel-1" });
  expect(insertedParcel).toMatchObject({
    land_value_cents: 5000013,
    improvement_value_cents: 15000051,
    net_value_cents: 20000063,
  });
  expect(Number.isInteger(insertedParcel?.land_value_cents)).toBe(true);
  expect(Number.isInteger(insertedParcel?.improvement_value_cents)).toBe(true);
  expect(Number.isInteger(insertedParcel?.net_value_cents)).toBe(true);
});

test("primary parcel conflicts load the existing parcel for downstream work", async () => {
  const client = {
    from(table: string) {
      if (table !== "parcels") throw new Error(`Unexpected table: ${table}`);
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
              data: { id: "existing-parcel" },
              error: null,
            }),
          };
          return chain;
        },
      };
    },
  };
  const repository = new SupabasePropertyDiscoveryWorkerRepository(
    client as never,
  );

  await expect(
    repository.recordParcel({
      propertyId: event.propertyId,
      companyId: "99999999-9999-4999-8999-999999999999",
      parcel: RESIDENTIAL_PARCEL,
    }),
  ).resolves.toEqual({ parcelId: "existing-parcel" });
});
