import {describe, expect, test, vi} from "vitest";
import {
  checkResumeVerification,
  startResumeVerification,
  type ResumeVerificationDependencies,
} from "./resume-verification";

const attemptId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const assessmentId = "33333333-3333-4333-8333-333333333333";
const publicToken = "44444444-4444-4444-8444-444444444444";
const reservationId = "55555555-5555-4555-8555-555555555555";
const to = "+16095550100";

function dependencies(overrides: Partial<ResumeVerificationDependencies> = {}) {
  return {
    repository: {
      reserveStart: vi.fn(async () => ({reservationId, companyId, to})),
      recordProviderStart: vi.fn(async () => undefined),
      findCheckContext: vi.fn(async () => ({companyId, to, providerAttemptId: "VEattempt"})),
      approve: vi.fn(async () => ({assessmentId, publicToken})),
    },
    provider: {
      start: vi.fn(async () => ({providerAttemptId: "VEattempt", status: "pending" as const})),
      check: vi.fn(async () => ({approved: true})),
    },
    ...overrides,
  } satisfies ResumeVerificationDependencies;
}

describe("resume verification use cases", () => {
  test("reserves a send before calling the provider and records provider evidence", async () => {
    const order: string[] = [];
    const deps = dependencies();
    vi.mocked(deps.repository.reserveStart).mockImplementation(async () => {
      order.push("reserve");
      return {reservationId, companyId, to};
    });
    vi.mocked(deps.provider.start).mockImplementation(async () => {
      order.push("provider");
      return {providerAttemptId: "VEattempt", status: "pending"};
    });
    vi.mocked(deps.repository.recordProviderStart).mockImplementation(async () => {
      order.push("record");
    });

    await expect(startResumeVerification({attemptId, requestIp: "203.0.113.7"}, deps))
      .resolves.toEqual({sent: true});
    expect(order).toEqual(["reserve", "provider", "record"]);
    expect(deps.repository.recordProviderStart).toHaveBeenCalledWith({
      attemptId,
      companyId,
      reservationId,
      providerAttemptId: "VEattempt",
    });
  });

  test("leaves a failed provider call counted and returns a generic start result", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.start).mockRejectedValue(new Error("provider internals"));

    await expect(startResumeVerification({attemptId, requestIp: "203.0.113.7"}, deps))
      .resolves.toEqual({sent: false});
    expect(deps.repository.recordProviderStart).not.toHaveBeenCalled();
  });

  test.each([
    ["unknown attempt", async () => null],
    ["minute cooldown", async () => { throw new Error("verification_start_cooldown"); }],
    ["phone hourly limit", async () => { throw new Error("verification_phone_limit"); }],
    ["IP hourly limit", async () => { throw new Error("verification_ip_limit"); }],
  ])("collapses %s to the same generic start result", async (_label, reserveStart) => {
    const deps = dependencies();
    vi.mocked(deps.repository.reserveStart).mockImplementation(reserveStart);

    await expect(startResumeVerification({attemptId, requestIp: "203.0.113.7"}, deps))
      .resolves.toEqual({sent: false});
    expect(deps.provider.start).not.toHaveBeenCalled();
  });

  test("does not approve or rotate while the provider reports pending", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.check).mockResolvedValue({approved: false});

    await expect(checkResumeVerification({attemptId, code: "314159"}, deps))
      .resolves.toEqual({approved: false});
    expect(deps.repository.approve).not.toHaveBeenCalled();
  });

  test("uses only the atomic approval boundary after provider approval", async () => {
    const deps = dependencies();

    await expect(checkResumeVerification({attemptId, code: "314159"}, deps))
      .resolves.toEqual({approved: true, assessmentId, publicToken});
    expect(deps.repository.approve).toHaveBeenCalledWith({
      attemptId,
      companyId,
      providerAttemptId: "VEattempt",
    });
  });

  test.each(["unknown context", "provider failure", "approval race"])(
    "returns one non-approved result for %s",
    async (label) => {
    const deps = dependencies();
    if (label === "unknown context") {
      vi.mocked(deps.repository.findCheckContext).mockResolvedValue(null);
    } else if (label === "provider failure") {
      vi.mocked(deps.provider.check).mockRejectedValue(new Error("network detail"));
    } else {
      vi.mocked(deps.repository.approve).mockRejectedValue(new Error("already consumed"));
    }

    await expect(checkResumeVerification({attemptId, code: "314159"}, deps))
      .resolves.toEqual({approved: false});
    },
  );

  test("rejects malformed attempt, IP, and code before dependencies run", async () => {
    const deps = dependencies();

    await expect(startResumeVerification({attemptId: "bad", requestIp: "not-an-ip"}, deps))
      .resolves.toEqual({sent: false});
    await expect(checkResumeVerification({attemptId, code: "31 4159"}, deps))
      .resolves.toEqual({approved: false});
    expect(deps.repository.reserveStart).not.toHaveBeenCalled();
    expect(deps.repository.findCheckContext).not.toHaveBeenCalled();
  });
});
