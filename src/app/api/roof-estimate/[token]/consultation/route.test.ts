import {describe, expect, test, vi} from "vitest";
import {ConsultationRateLimitError, type AssessmentResultRepository} from "@/modules/roof-assessment/request-consultation";
import {handleConsultationRequest} from "./route";

const token = "11111111-1111-4111-8111-111111111111";
function repo(): AssessmentResultRepository {
  return {
    findCompletedByToken: vi.fn(async () => ({companyId: "22222222-2222-4222-8222-222222222222", assessmentId: "33333333-3333-4333-8333-333333333333", estimateId: "44444444-4444-4444-8444-444444444444"})),
    requestConsultation: vi.fn(async (_context, preference) => ({status: "requested", ...preference, timezone: "America/New_York"})),
    consumeResultViewLimit: vi.fn(async () => true),
    markResultViewed: vi.fn(async () => ({resultViewedAt: "2026-08-26T12:00:00.000Z", metaDeliveryId: null, metaEvent: null})),
  };
}

describe("token-scoped consultation route", () => {
  test("returns only the safe preference summary with no-store", async () => {
    const response = await handleConsultationRequest({token, body: {contactMethod: "text", callWindow: null}, requestIp: "127.0.0.1", repository: repo()});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({status: "requested", contactMethod: "text", callWindow: null, timezone: "America/New_York"});
    expect(JSON.stringify(body)).not.toMatch(/11111111|22222222|33333333|44444444|email|phone/i);
  });

  test.each(["not-a-uuid", "00000000-0000-0000-0000-000000000000"])("uses one generic not-found response for %s", async (value) => {
    const repository = repo();
    if (value.startsWith("0000")) repository.findCompletedByToken = vi.fn(async () => null);
    const response = await handleConsultationRequest({token: value, body: {contactMethod: "email", callWindow: null}, requestIp: "127.0.0.1", repository});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error: "Assessment not found"});
  });

  test("returns a privacy-safe no-store throttle response", async () => {
    const repository=repo();
    repository.requestConsultation=vi.fn(async()=>{throw new ConsultationRateLimitError();});
    const response=await handleConsultationRequest({token,body:{contactMethod:"email",callWindow:null},requestIp:"127.0.0.1",repository});
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({error:"Request limit reached. Please try again later."});
  });
});
