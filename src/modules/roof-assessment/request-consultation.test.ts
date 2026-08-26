import {describe, expect, test, vi} from "vitest";
import {
  AssessmentResultAccessError,
  markRoofAssessmentResultViewed,
  parseConsultationRpcResult,
  parseResultViewedRpcResult,
  requestRoofConsultation,
  type AssessmentResultRepository,
} from "./request-consultation";

const token = "11111111-1111-4111-8111-111111111111";
const context = {
  companyId: "22222222-2222-4222-8222-222222222222",
  assessmentId: "33333333-3333-4333-8333-333333333333",
  estimateId: "44444444-4444-4444-8444-444444444444",
};

function repository(overrides: Partial<AssessmentResultRepository> = {}): AssessmentResultRepository {
  return {
    findCompletedByToken: vi.fn(async () => context),
    requestConsultation: vi.fn(async (_context, preference) => ({
      status: "requested" as const, ...preference, timezone: "America/New_York" as const,
    })),
    markResultViewed: vi.fn(async () => ({resultViewedAt: "2026-08-26T12:00:00.000Z"})),
    ...overrides,
  };
}

describe("assessment result actions", () => {
  test.each<readonly [unknown,string]>([
    [{contactMethod: "call", callWindow: null}, "Choose an Eastern Time call window"],
    [{contactMethod: "text", callWindow: "morning"}, "Call windows are only available for calls"],
    [{contactMethod: "email", callWindow: "evening"}, "Call windows are only available for calls"],
  ])("rejects invalid consultation preference %o", async (input, message) => {
    await expect(requestRoofConsultation(token, input, "127.0.0.1", repository())).rejects.toMatchObject({
      status: 400, message,
    });
  });

  test("binds a valid request to the completed assessment resolved from the token", async () => {
    const repo = repository();
    await expect(requestRoofConsultation(token, {contactMethod: "call", callWindow: "midday"}, "127.0.0.1", repo))
      .resolves.toEqual({status: "requested", contactMethod: "call", callWindow: "midday", timezone: "America/New_York"});
    expect(repo.requestConsultation).toHaveBeenCalledWith(context, {
      contactMethod: "call", callWindow: "midday",
    }, "127.0.0.1");
  });

  test("returns one generic not-found error for a token without a completed assessment", async () => {
    const repo = repository({findCompletedByToken: vi.fn(async () => null)});
    await expect(requestRoofConsultation(token, {contactMethod: "text", callWindow: null}, "127.0.0.1", repo))
      .rejects.toEqual(new AssessmentResultAccessError("Assessment not found", 404));
  });

  test("marks only the completed assessment bound to the public token", async () => {
    const repo = repository();
    await expect(markRoofAssessmentResultViewed(token, repo)).resolves.toEqual({resultViewed: true});
    expect(repo.markResultViewed).toHaveBeenCalledWith(context);
  });

  test.each([
    [[], "missing row"],
    [[{status: "requested"}], "missing fields"],
    [[{request_id: token,status:"requested",created_at:"2026-08-26T12:00:00.000Z",contact_method:"text",call_window:null,timezone:"America/New_York",internal_id:token}], "extra field"],
    [[{request_id: token,status:"requested",created_at:"2026-08-26T12:00:00.000Z",contact_method:"email",call_window:null,timezone:"America/New_York"}], "mismatched preference"],
  ] as Array<[unknown,string]>)('rejects malformed raw consultation RPC output: $1', (data) => {
    expect(() => parseConsultationRpcResult(data, {contactMethod:"text",callWindow:null})).toThrow("Consultation persistence failed");
  });

  test.each<readonly [unknown]>([
    [[]],
    [[{result_viewed_at:"not-a-time"}]],
    [[{result_viewed_at:"2026-08-26T12:00:00.000Z",assessment_id:token}]],
  ])("rejects malformed raw result-view RPC output %#", (data) => {
    expect(() => parseResultViewedRpcResult(data)).toThrow("Result view persistence failed");
  });
});
