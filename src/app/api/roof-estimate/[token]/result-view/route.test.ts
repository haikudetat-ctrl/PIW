import {describe, expect, test, vi} from "vitest";
import type {AssessmentResultRepository} from "@/modules/roof-assessment/request-consultation";
import {handleResultViewRequest} from "./route";

const token = "11111111-1111-4111-8111-111111111111";
function repo(): AssessmentResultRepository {
  return {
    findCompletedByToken: vi.fn(async () => ({companyId: "22222222-2222-4222-8222-222222222222", assessmentId: "33333333-3333-4333-8333-333333333333", estimateId: "44444444-4444-4444-8444-444444444444"})),
    requestConsultation: vi.fn(),
    markResultViewed: vi.fn(async () => ({resultViewedAt: "2026-08-26T12:00:00.000Z"})),
  };
}

describe("token-scoped result view route", () => {
  test("marks the exact completed result without returning internal state", async () => {
    const repository = repo();
    const response = await handleResultViewRequest({token, repository});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({resultViewed: true});
    expect(repository.markResultViewed).toHaveBeenCalledOnce();
  });

  test("uses a generic not-found response when the completed binding is absent", async () => {
    const repository = repo();
    repository.findCompletedByToken = vi.fn(async () => null);
    const response = await handleResultViewRequest({token, repository});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error: "Assessment not found"});
  });
});
