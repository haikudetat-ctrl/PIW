import { describe, expect, test, vi } from "vitest";
import { measurePropertyPreview, type MeasurePreviewDependencies } from "./measure-preview";

const scope = {companyId: "11111111-1111-4111-8111-111111111111", previewId: "22222222-2222-4222-8222-222222222222"};
const preview = {
  propertyId: "33333333-3333-4333-8333-333333333333",
  measurementStatus: "pending" as const,
  canonicalAddress: "1 Main St, Newark, NJ 07102, USA",
  latitude: 40.7357,
  longitude: -74.1724,
};
const success = {status: "success" as const, totalRoofSqft: 2400, roofSegments: []};

function dependencies(overrides: Partial<MeasurePreviewDependencies> = {}) {
  return {
    loadPreview: vi.fn(async () => preview),
    findCachedInsight: vi.fn(async () => null),
    reserveSolarCall: vi.fn(async () => ({allowed: true})),
    beginProviderRequest: vi.fn(async () => ({providerRequestId: "pr-1"})),
    measureRoof: vi.fn(async () => ({insight: success, retrievedAt: "2026-10-03T12:00:00.000Z", sourceIdentifier: "solar:1"})),
    persistInsight: vi.fn(async () => ({id: "insight-1"})),
    completeProviderRequest: vi.fn(async () => undefined),
    failProviderRequest: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
    ...overrides,
  } satisfies MeasurePreviewDependencies;
}

describe("measurePropertyPreview", () => {
  test("measures an uncached roof once and links the insight to the preview", async () => {
    const deps = dependencies();
    await expect(measurePropertyPreview(scope, deps)).resolves.toEqual({kind: "measured"});
    expect(deps.findCachedInsight).toHaveBeenCalledWith({companyId: scope.companyId, normalizedAddress: expect.any(String)});
    expect(deps.beginProviderRequest).toHaveBeenCalledWith({companyId: scope.companyId, previewId: scope.previewId});
    expect(deps.measureRoof).toHaveBeenCalledWith(expect.objectContaining({latitude: 40.7357, longitude: -74.1724}));
    expect(deps.persistInsight).toHaveBeenCalledWith(expect.objectContaining({
      companyId: scope.companyId,
      propertyId: preview.propertyId,
      insight: success,
    }));
    expect(deps.complete).toHaveBeenCalledWith({...scope, roofInsightId: "insight-1", status: "ready"});
  });

  test("reuses a cached insight without reserving budget or calling Solar", async () => {
    const deps = dependencies({findCachedInsight: vi.fn(async () => ({id: "cached-1", insight: {status: "no_coverage" as const}}))});
    await expect(measurePropertyPreview(scope, deps)).resolves.toEqual({kind: "cache_hit"});
    expect(deps.reserveSolarCall).not.toHaveBeenCalled();
    expect(deps.measureRoof).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith({...scope, roofInsightId: "cached-1", status: "no_coverage"});
  });

  test("skips the reveal when the monthly Solar budget is exhausted", async () => {
    const deps = dependencies({reserveSolarCall: vi.fn(async () => ({allowed: false}))});
    await expect(measurePropertyPreview(scope, deps)).resolves.toEqual({kind: "budget_exhausted"});
    expect(deps.measureRoof).not.toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith({...scope, status: "skipped"});
  });

  test("marks the measurement unavailable when Solar fails, without throwing", async () => {
    const deps = dependencies({measureRoof: vi.fn(async () => { throw new Error("solar 500"); })});
    await expect(measurePropertyPreview(scope, deps)).resolves.toEqual({kind: "unavailable"});
    expect(deps.failProviderRequest).toHaveBeenCalledWith({companyId: scope.companyId, providerRequestId: "pr-1"});
    expect(deps.setStatus).toHaveBeenCalledWith({...scope, status: "unavailable"});
    expect(deps.complete).not.toHaveBeenCalled();
  });

  test("does nothing for a missing, already measured, or unresolved preview", async () => {
    for (const loaded of [null, {...preview, measurementStatus: "ready" as const}]) {
      const deps = dependencies({loadPreview: vi.fn(async () => loaded)});
      await expect(measurePropertyPreview(scope, deps)).resolves.toEqual({kind: "skipped"});
      expect(deps.findCachedInsight).not.toHaveBeenCalled();
    }
    const unresolved = dependencies({loadPreview: vi.fn(async () => ({...preview, latitude: null, longitude: null, canonicalAddress: null}))});
    await expect(measurePropertyPreview(scope, unresolved)).resolves.toEqual({kind: "unavailable"});
    expect(unresolved.setStatus).toHaveBeenCalledWith({...scope, status: "unavailable"});
  });
});
