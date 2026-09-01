import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(() => ({})),
  resolveAssessmentJourneyScope: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  parseServerEnv: () => ({ROOF_ASSESSMENT_SIGNING_SECRET: "server-signing-secret"}),
}));
vi.mock("@/lib/supabase/service", () => ({createServiceClient: mocks.createServiceClient}));
vi.mock("@/modules/roof-assessment/analysis-telemetry", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/roof-assessment/analysis-telemetry")>();
  return {
    ...original,
    resolveAssessmentJourneyScope: mocks.resolveAssessmentJourneyScope,
    SupabaseAssessmentJourneyScopeRepository: class {},
  };
});

import {POST} from "./route";

const token = "11111111-1111-4111-8111-111111111111";
const params = {params: Promise.resolve({token})};

describe("analysis reveal event route", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  test("derives correlation server-side and emits one privacy-safe allowlisted record", async () => {
    mocks.resolveAssessmentJourneyScope.mockResolvedValue({
      correlation: "raj_0123456789abcdef0123456789abcdef",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await POST(new Request("https://example.test", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({durationMs: 12_000, outcome: "pending_at_12s"}),
    }) as never, params);

    expect(response.status).toBe(204);
    expect(mocks.resolveAssessmentJourneyScope).toHaveBeenCalledWith(
      token,
      expect.anything(),
      "server-signing-secret",
    );
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      correlation: "raj_0123456789abcdef0123456789abcdef",
      durationMs: 12_000,
      event: "assessment_analysis_revealed",
      level: "info",
      outcome: "pending_at_12s",
    });
    expect(String(log.mock.calls[0]?.[0])).not.toContain(token);
    expect(String(log.mock.calls[0]?.[0])).not.toContain("22222222-2222-4222-8222-222222222222");
  });

  test("rejects client correlation and provider fields", async () => {
    const response = await POST(new Request("https://example.test", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        correlation: "browser-controlled",
        durationMs: 8_000,
        outcome: "ready_at_8s",
        placeId: "sensitive",
      }),
    }) as never, params);
    expect(response.status).toBe(400);
    expect(mocks.resolveAssessmentJourneyScope).not.toHaveBeenCalled();
  });
});
