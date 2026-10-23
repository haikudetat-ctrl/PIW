import {describe, expect, test, vi} from "vitest";
import type {RoofEstimateEvent} from "@/inngest/functions/roof-estimate-worker";
import {priceConvertedLead, type ConversionPricingDependencies} from "./price-at-conversion";

const companyId = "11111111-1111-4111-8111-111111111111";
const leadId = "22222222-2222-4222-8222-222222222222";
const event: RoofEstimateEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  pipelineRunId: "44444444-4444-4444-8444-444444444444",
  correlationId: "55555555-5555-4555-8555-555555555555",
  leadId,
  propertyId: "66666666-6666-4666-8666-666666666666",
  canonicalAddress: "18 Harbor View Dr, Red Bank, NJ 07701, USA",
  latitude: 40.35,
  longitude: -74.07,
  attempt: 1,
};

function deps(overrides: Partial<ConversionPricingDependencies> = {}) {
  return {
    findDiscoveryEvent: vi.fn(async () => event),
    hasCachedMeasurement: vi.fn(async () => true),
    run: vi.fn(async () => ({outcome: "ready"})),
    defer: vi.fn(),
    log: vi.fn(),
    ...overrides,
  } satisfies ConversionPricingDependencies;
}

describe("pricing a value-first lead at conversion", () => {
  test("runs the estimate worker step on the queued discovery event", async () => {
    const d = deps();
    const result = await priceConvertedLead({companyId, leadId}, d);
    expect(result).toMatchObject({kind: "priced", outcome: "ready"});
    expect(d.findDiscoveryEvent).toHaveBeenCalledWith({companyId, leadId});
    expect(d.hasCachedMeasurement).toHaveBeenCalledWith({companyId, event});
    expect(d.run).toHaveBeenCalledWith(event);
    expect(d.defer).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({message: "preview_conversion_pricing", kind: "priced"}));
  });

  test("leaves leads without a queued discovery event to the worker", async () => {
    const d = deps({findDiscoveryEvent: vi.fn(async () => null)});
    expect(await priceConvertedLead({companyId, leadId}, d)).toEqual({kind: "skipped", reason: "no_discovery_event"});
    expect(d.run).not.toHaveBeenCalled();
  });

  test("never measures from the submit request", async () => {
    const d = deps({hasCachedMeasurement: vi.fn(async () => false)});
    expect(await priceConvertedLead({companyId, leadId}, d)).toEqual({kind: "skipped", reason: "not_measured"});
    expect(d.run).not.toHaveBeenCalled();
  });

  test("stops waiting after the budget and lets the work finish after the response", async () => {
    let finish!: (value: {outcome: string}) => void;
    const defer = vi.fn<(work: Promise<unknown>) => void>();
    const d = deps({defer, run: vi.fn(() => new Promise<{outcome: string}>((resolve) => { finish = resolve; }))});
    const result = await priceConvertedLead({companyId, leadId, budgetMs: 5}, d);
    expect(result.kind).toBe("deferred");
    expect(defer).toHaveBeenCalledOnce();
    finish({outcome: "ready"});
    await expect(defer.mock.calls[0][0]).resolves.toEqual({kind: "done", outcome: "ready"});
  });

  test("reports a failed run without throwing", async () => {
    const d = deps({run: vi.fn(async () => { throw new Error("finalize failed"); })});
    expect((await priceConvertedLead({companyId, leadId}, d)).kind).toBe("failed");
    expect(d.log).toHaveBeenCalledWith({message: "preview_conversion_pricing_error", error: "finalize failed"});
  });
});
