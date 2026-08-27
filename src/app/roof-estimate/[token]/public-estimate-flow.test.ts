import {describe, expect, test} from "vitest";
import {getAssessmentCalculationState, getAssessmentResultCta, getAssessmentResultRange} from "./public-estimate-flow";

const insight = {
  id: "99999999-9999-4999-8999-999999999999",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  propertyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provider: "google_solar",
  lookupStatus: "success",
};

describe("trustworthy public assessment result states", () => {
  test("admits a range only from a complete trustworthy Google calculation", () => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      expectedCompanyId: insight.companyId, expectedPropertyId: insight.propertyId, insight,
      lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5,
      generatedAt: "2026-08-26T12:00:00.000Z",
    });
    expect(getAssessmentResultRange(state)).toMatchObject({
      status: "ready", source: "google", lowCents: 1_850_000,
      highCents: 2_475_000, roofSquares: 24.5,
    });
  });

  test("admits Supabase timestamptz offsets for a trustworthy Google calculation", () => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      expectedCompanyId: insight.companyId, expectedPropertyId: insight.propertyId, insight,
      lowCents: 846_348, highCents: 1_269_522, roofSquares: 16.9,
      generatedAt: "2026-08-27T16:47:44.123456+00:00",
    });
    expect(state).toEqual({
      status: "ready", source: "google", lowCents: 846_348,
      highCents: 1_269_522, roofSquares: 16.9,
      generatedAt: "2026-08-27T16:47:44.123Z",
    });
  });

  test.each([
    [{status: "pending"} as const],
    [{status: "review_required", reason: "low_confidence"} as const],
  ])("never derives a range from %o", (state) => {
    expect(getAssessmentResultRange(state)).toBeNull();
  });

  test.each([
    {insight: null, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, propertyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, provider: "manual"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, lookupStatus: "error"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight, lowCents: 0, highCents: 2_475_000, roofSquares: 24.5},
    {insight, lowCents: 2_475_000, highCents: 1_850_000, roofSquares: 24.5},
    {insight, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 0},
  ])("downgrades invalid ready data without retaining numeric props: %o", (metrics) => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      generatedAt: "2026-08-26T12:00:00.000Z",
      expectedCompanyId: insight.companyId, expectedPropertyId: insight.propertyId, ...metrics,
    });
    expect(state).toEqual({status: "review_required", reason: "low_confidence"});
    expect(JSON.stringify(state)).not.toMatch(/1850000|2475000|24\.5/);
  });

  test.each(["failed", "partial", "review_required"])("rejects a ready estimate from a %s pipeline", (pipelineStatus) => {
    const state=getAssessmentCalculationState({estimateStatus:"ready",pipelineStatus,expectedCompanyId:insight.companyId,expectedPropertyId:insight.propertyId,insight,lowCents:1_850_000,highCents:2_475_000,roofSquares:24.5,generatedAt:"2026-08-26T12:00:00.000Z"});
    expect(state).toEqual({status:"review_required",reason:"low_confidence"});
  });

  test.each([
    [{status:"ready",source:"google",lowCents:1,highCents:2,roofSquares:1,generatedAt:"2026-08-26T12:00:00.000Z"} as const,"Turn this range into an exact quote"],
    [{status:"pending"} as const,"Review my roof with a specialist"],
    [{status:"review_required",reason:"low_confidence"} as const,"Review my roof with a specialist"],
  ])("uses state-aware replacement CTA copy for %o",(state,expected)=>{
    expect(getAssessmentResultCta("replacement_may_make_sense",state)).toBe(expected);
  });
});
