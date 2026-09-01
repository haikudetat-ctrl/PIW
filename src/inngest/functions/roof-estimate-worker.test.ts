import { describe, expect, it, vi } from "vitest";
import type { GoogleSolarInsight } from "@/domain/roof-estimate";
import {calculateRoofPricingPackages, type RoofPricingTierRate} from "@/domain/roof-pricing";
import {
  runRoofEstimate,
  type RoofEstimateWorkerRepository,
  type RoofInsightRecord,
} from "./roof-estimate-worker";

const event = {
  id: "event-1",
  pipelineRunId: "run-1",
  correlationId: "correlation-1",
  leadId: "lead-1",
  propertyId: "property-1",
  canonicalAddress: "12 Birch Street, Trenton, NJ 08608",
  latitude: 40.22,
  longitude: -74.76,
  attempt: 1,
};

const insight: GoogleSolarInsight = {
  status: "success",
  buildingName: "buildings/abc",
  latitude: 40.22,
  longitude: -74.76,
  imageryDate: "2025-06-01",
  imageryQuality: "HIGH",
  roofSegments: [{ pitchDegrees: 25, azimuthDegrees: 180, areaSqft: 2_500 }],
  totalRoofSqft: 2_500,
  rawResponse: {},
};

const record: RoofInsightRecord = {
  id: "insight-1",
  insight,
  retrievedAt: "2026-07-31T12:00:00.000Z",
};

const tierRates: RoofPricingTierRate[] = [
  {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"Complete.",warrantySummary:"Enhanced.",differentiators:["Finish"],lowCentsPerSquare:80000,highCentsPerSquare:97500},
  {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"Upgraded.",warrantySummary:"Extended.",differentiators:["Weight"],lowCentsPerSquare:95000,highCentsPerSquare:120000},
  {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"Premium.",warrantySummary:"Extended.",differentiators:["Impact"],lowCentsPerSquare:125000,highCentsPerSquare:165000},
];
const calculated=calculateRoofPricingPackages(25,tierRates,"all-season-nj-2026-v1","2026-08-31T12:00:00.000Z");
const finalized={...calculated,roofSquares:25,adjustments:[],pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    assertConsentedScope: vi.fn(async () => ({
      companyId: "company-1",
      estimateId: "estimate-1",
      name: "Alex Customer",
      phone: "+16095550100",
      email: "alex@example.com",
    })),
    upsertWorkerRunQueued: vi.fn(async () => ({ id: "worker-1", status: "queued" })),
    startEstimating: vi.fn(async () => undefined),
    findReusableEstimate: vi.fn(async () => null),
    reuseEstimate: vi.fn(async () => finalized),
    findCachedInsight: vi.fn(async () => null),
    beginProviderRequest: vi.fn(async () => ({ providerRequestId: "request-1" })),
    markProviderCacheHit: vi.fn(async () => undefined),
    reserveSolarCall: vi.fn(async () => ({ allowed: true, reservedCount: 1 })),
    measureRoof: vi.fn(async () => ({
      insight,
      retrievedAt: record.retrievedAt,
      sourceIdentifier: "buildings/abc",
    })),
    persistInsight: vi.fn(async () => record),
    completeProviderRequest: vi.fn(async () => undefined),
    blockProviderRequest: vi.fn(async () => undefined),
    failProviderRequest: vi.fn(async () => undefined),
    finalizeEstimate: vi.fn(async (input:{status:string}) => input.status === "ready" ? finalized : null),
    queueDeliveries: vi.fn(async () => undefined),
    queueContextDialer: vi.fn(async () => undefined),
    completePipeline: vi.fn(async () => undefined),
    markWorkerRunCompleted: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as RoofEstimateWorkerRepository & Record<string, ReturnType<typeof vi.fn>>;
}

describe("runRoofEstimate", () => {
  it("reuses the latest ready quote for the canonical property without calling Google", async () => {
    const reusable = {
      sourceEstimateId: "estimate-original",
      roofInsightId: "insight-original",
      totalRoofSqft: 2_500,
      assumptions: { market: "New Jersey average" },
      estimate: finalized,
    };
    const repo = repository({ findReusableEstimate: vi.fn(async () => reusable) });

    await expect(runRoofEstimate(event, repo)).resolves.toEqual({
      outcome: "reused_ready_quote",
      workerRunId: "worker-1",
      sourceEstimateId: "estimate-original",
    });
    expect(repo.reuseEstimate).toHaveBeenCalledWith({
      estimateId: "estimate-1",
      companyId: "company-1",
      reusable,
    });
    expect(repo.beginProviderRequest).not.toHaveBeenCalled();
    expect(repo.reserveSolarCall).not.toHaveBeenCalled();
    expect(repo.measureRoof).not.toHaveBeenCalled();
    expect(repo.queueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", estimate: reusable.estimate }),
    );
    expect(repo.queueContextDialer).toHaveBeenCalledOnce();
    expect(repo.completePipeline).toHaveBeenCalledOnce();
  });

  it("reuses cached measurements without consuming the monthly Solar budget", async () => {
    const repo = repository({ findCachedInsight: vi.fn(async () => record) });
    await expect(runRoofEstimate(event, repo)).resolves.toEqual({
      outcome: "ready",
      workerRunId: "worker-1",
    });
    expect(repo.markProviderCacheHit).toHaveBeenCalledOnce();
    expect(repo.reserveSolarCall).not.toHaveBeenCalled();
    expect(repo.queueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        estimate: expect.objectContaining({
          pricingVersion: "all-season-nj-2026-v1",
          packages: expect.arrayContaining([
            expect.objectContaining({tierKey:"good",rangeLowCents:2_000_000}),
            expect.objectContaining({tierKey:"better",rangeHighCents:3_000_000}),
            expect.objectContaining({tierKey:"best",rangeHighCents:4_125_000}),
          ]),
        }),
      }),
    );
    expect(repo.queueContextDialer).toHaveBeenCalledWith({
      estimateId: "estimate-1",
      companyId: "company-1",
      leadId: "lead-1",
      pipelineRunId: "run-1",
    });
  });

  it("stops before the provider call when the 9,500-call reservation is full", async () => {
    const repo = repository({
      reserveSolarCall: vi.fn(async () => ({ allowed: false, reservedCount: 9_500 })),
    });
    await expect(runRoofEstimate(event, repo)).resolves.toEqual({
      outcome: "quota_exhausted",
      workerRunId: "worker-1",
    });
    expect(repo.measureRoof).not.toHaveBeenCalled();
    expect(repo.blockProviderRequest).toHaveBeenCalledOnce();
    expect(repo.queueDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ status: "quota_exhausted" }),
    );
    expect(repo.queueContextDialer).toHaveBeenCalledOnce();
  });

  it("measures, persists, prices, and queues both-channel content", async () => {
    const repo = repository();
    await expect(runRoofEstimate(event, repo)).resolves.toEqual({
      outcome: "ready",
      workerRunId: "worker-1",
    });
    expect(repo.reserveSolarCall).toHaveBeenCalledOnce();
    expect(repo.measureRoof).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 40.22,
      longitude: -74.76,
    }));
    expect(repo.persistInsight).toHaveBeenCalledOnce();
    expect(repo.completePipeline).toHaveBeenCalledOnce();
    expect(repo.queueContextDialer).toHaveBeenCalledOnce();
    expect(repo.markWorkerRunCompleted).toHaveBeenCalledWith("worker-1");
  });
});
