import {describe, expect, test, vi} from "vitest";
import {
  buildAssessmentAnalysisLog,
  createAssessmentJourneyCorrelation,
  resolveAssessmentJourneyScope,
  SupabaseAssessmentJourneyScopeRepository,
} from "./analysis-telemetry";

const token = "11111111-1111-4111-8111-111111111111";
const assessmentId = "22222222-2222-4222-8222-222222222222";
const submissionId = "33333333-3333-4333-8333-333333333333";
const companyId = "44444444-4444-4444-8444-444444444444";
const signingSecret = "a-test-signing-secret-that-is-at-least-32-bytes";

describe("assessment analysis telemetry", () => {
  test("derives a stable opaque correlation from the exact consumed attempt submission", async () => {
    const findTokenScope = vi.fn().mockResolvedValue({
      assessmentId,
      companyId,
      estimateId: "55555555-5555-4555-8555-555555555555",
    });
    const findOriginatingAttempt = vi.fn().mockResolvedValue({submissionId});

    const scope = await resolveAssessmentJourneyScope(token, {
      findTokenScope,
      findOriginatingAttempt,
    }, signingSecret);

    expect(findTokenScope).toHaveBeenCalledWith(token);
    expect(findOriginatingAttempt).toHaveBeenCalledWith({
      assessmentId,
      companyId,
      estimateId: "55555555-5555-4555-8555-555555555555",
    });
    expect(scope).toEqual({
      correlation: createAssessmentJourneyCorrelation(companyId, submissionId, signingSecret),
    });
    expect(scope?.correlation).toMatch(/^raj_[a-f0-9]{32}$/);
    expect(scope?.correlation).toBe("raj_1968c81cf2d118f7650401803926a154");
    expect(scope?.correlation).not.toContain(submissionId);
    expect(scope?.correlation).not.toContain(token);
  });

  test("does not fall back to a lead's latest submission when the token attempt is unavailable", async () => {
    const findOriginatingAttempt = vi.fn().mockResolvedValue(null);
    const scope = await resolveAssessmentJourneyScope(token, {
      findTokenScope: vi.fn().mockResolvedValue({
        assessmentId,
        companyId,
        estimateId: "55555555-5555-4555-8555-555555555555",
      }),
      findOriginatingAttempt,
    }, signingSecret);
    expect(scope).toBeNull();
    expect(findOriginatingAttempt).toHaveBeenCalledOnce();
  });

  test("a later consumed resume submission cannot rebind the originating correlation", async () => {
    const resumeSubmissionId = "66666666-6666-4666-8666-666666666666";
    const repository = {
      findTokenScope: vi.fn().mockResolvedValue({
        assessmentId,
        companyId,
        estimateId: "55555555-5555-4555-8555-555555555555",
      }),
      // The repository contract returns the unique consumed `new` attempt;
      // consumed resume_candidate rows are deliberately outside this relation.
      findOriginatingAttempt: vi.fn().mockResolvedValue({submissionId}),
    };
    const scope = await resolveAssessmentJourneyScope(token, repository, signingSecret);
    expect(scope?.correlation).toBe(
      createAssessmentJourneyCorrelation(companyId, submissionId, signingSecret),
    );
    expect(scope?.correlation).not.toBe(
      createAssessmentJourneyCorrelation(companyId, resumeSubmissionId, signingSecret),
    );
  });

  test("separates identical submission ids across tenant scope", () => {
    const otherCompanyId = "77777777-7777-4777-8777-777777777777";
    const first = createAssessmentJourneyCorrelation(
      companyId,
      submissionId,
      signingSecret,
    );
    const second = createAssessmentJourneyCorrelation(
      otherCompanyId,
      submissionId,
      signingSecret,
    );

    expect(first).not.toBe(second);
    expect(first).toMatch(/^raj_[a-f0-9]{32}$/);
    expect(second).toMatch(/^raj_[a-f0-9]{32}$/);
    expect(`${first}${second}`).not.toContain(companyId);
    expect(`${first}${second}`).not.toContain(submissionId);
  });

  test("emits only the allowlisted reveal record", () => {
    const correlation = createAssessmentJourneyCorrelation(
      companyId,
      submissionId,
      signingSecret,
    );
    const record = buildAssessmentAnalysisLog({
      correlation,
      durationMs: 9_000,
      outcome: "ready_between_8s_12s",
    });
    expect(record).toEqual({
      correlation,
      durationMs: 9_000,
      event: "assessment_analysis_revealed",
      level: "info",
      outcome: "ready_between_8s_12s",
    });
    const serialized = JSON.stringify(record);
    for (const forbidden of [token, assessmentId, submissionId, "address", "place", "latitude", "contact"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("queries only the unique consumed new attempt and fails closed on ambiguity", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      not: vi.fn(),
      limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [{submission_id: submissionId}, {submission_id: crypto.randomUUID()}],
      error: null,
    });
    const repository = new SupabaseAssessmentJourneyScopeRepository({
      from: vi.fn(() => query),
    } as never);

    await expect(repository.findOriginatingAttempt({
      assessmentId,
      companyId,
      estimateId: "55555555-5555-4555-8555-555555555555",
    })).resolves.toBeNull();
    expect(query.eq).toHaveBeenCalledWith("attempt_kind", "new");
    expect(query.not).toHaveBeenCalledWith("consumed_at", "is", null);
    expect(query.limit).toHaveBeenCalledWith(2);
  });
});
