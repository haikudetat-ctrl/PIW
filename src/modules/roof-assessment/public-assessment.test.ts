import { describe, expect, test } from "vitest";
import type { RoofAssessmentResponses } from "@/domain/roof-assessment";
import {
  completePublicAssessment,
  getPublicAssessment,
  PublicAssessmentError,
  savePublicAssessmentProgress,
  type AssessmentCompletion,
  type AssessmentProgressPatch,
  type PersistedAssessment,
  type PublicAssessmentRepository,
  type PublicEstimateContext,
} from "./public-assessment";

const token = "11111111-1111-4111-8111-111111111111";
const context: PublicEstimateContext = {
  estimateId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  leadId: "44444444-4444-4444-8444-444444444444",
  campaign: "weather-report",
  address: "1 Main St, Newark, NJ 07102",
};

const completeResponses: RoofAssessmentResponses = {
  reason: "active_leak",
  roofAge: "20_plus",
  conditionSignals: ["active_leak", "curling_or_cracking"],
  roofVisible: "yes",
  visibleCondition: "heavy_wear",
  stories: "two",
  complexityFeatures: ["garage", "multiple_levels"],
  priority: "speed",
  timeline: "asap",
  ownership: "owner",
};
const completeExceptOwnership: Partial<RoofAssessmentResponses> = {
  ...completeResponses,
  ownership: undefined,
};

function seedFinalStep(repository: MemoryAssessmentRepository) {
  repository.assessment = {
    id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress",
    revision: 0,
    currentStep: 8,
    propertyRevealedAt: null,
    lastAnsweredAt: null,
    responses: completeExceptOwnership,
    recommendation: null,
  };
}

class MemoryAssessmentRepository implements PublicAssessmentRepository {
  assessment: PersistedAssessment | null = null;
  completion: AssessmentCompletion | null = null;
  lifecycleEvents = new Set<string>();
  failNextSave = false;

  async findEstimateByToken(value: string) {
    return value === token ? context : null;
  }

  async findOrCreateAssessment(_context: PublicEstimateContext) {
    this.assessment ??= {
      id: "55555555-5555-4555-8555-555555555555",
      status: "in_progress",
      revision: 0,
      currentStep: 0,
      propertyRevealedAt: null,
      lastAnsweredAt: null,
      responses: {},
      recommendation: null,
    };
    return this.assessment;
  }

  async saveProgress(
    _assessmentId: string,
    patch: AssessmentProgressPatch,
  ) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("persistence unavailable");
    }
    const current = await this.findOrCreateAssessment(context);
    if (patch.expectedRevision !== current.revision) {
      return {assessment: current, applied: false};
    }
    const lastAnsweredAt = new Date().toISOString();
    this.assessment = {
      ...current,
      revision: current.revision + 1,
      currentStep: Math.max(current.currentStep, patch.currentStep),
      propertyRevealedAt: patch.propertyRevealedAt ?? current.propertyRevealedAt,
      lastAnsweredAt,
      responses: {...current.responses, ...patch.responsePatch},
    };
    if (patch.signals.highIntent) {
      this.lifecycleEvents.add(`roof/assessment.high_intent:${this.assessment.id}`);
    }
    return {assessment: this.assessment, applied: true};
  }

  async complete(
    _assessmentId: string,
    completion: AssessmentCompletion,
  ) {
    const current = await this.findOrCreateAssessment(context);
    if (completion.expectedRevision !== current.revision) {
      return {assessment: current, applied: false};
    }
    this.completion = completion;
    this.assessment = {
      ...current,
      status: "completed",
      revision: current.revision + 1,
      currentStep: 9,
      responses: completion.responses,
      recommendation: completion.recommendation,
    };
    if (completion.signals.highIntent) {
      this.lifecycleEvents.add(`roof/assessment.high_intent:${this.assessment.id}`);
    }
    this.lifecycleEvents.add(`roof/assessment.completed:${this.assessment.id}`);
    return {assessment: this.assessment, applied: true};
  }
}

describe("public roof assessment", () => {
  test("creates and returns public-safe state for a valid estimate token", async () => {
    const result = await getPublicAssessment(token, new MemoryAssessmentRepository());

    expect(result).toEqual({
      status: "in_progress",
      revision: 0,
      currentStep: 0,
      propertyRevealed: false,
      lastAnsweredAt: null,
      responses: {},
      recommendation: null,
      campaign: "weather-report",
      address: "1 Main St, Newark, NJ 07102",
      imageUrl: `/api/roof-estimate/${token}/house-image`,
    });
    expect(result).not.toHaveProperty("scores");
  });

  test("returns not found without creating state for an unknown token", async () => {
    await expect(
      getPublicAssessment("99999999-9999-4999-8999-999999999999", new MemoryAssessmentRepository()),
    ).rejects.toEqual(expect.objectContaining<Partial<PublicAssessmentError>>({status: 404}));
  });

  test("merges a validated partial response and marks the property revealed", async () => {
    const repository = new MemoryAssessmentRepository();
    await savePublicAssessmentProgress(token, {
      expectedRevision: 0,
      questionId: "reason",
      propertyRevealed: true,
      responsePatch: {reason: "roof_age"},
    }, repository);
    const result = await savePublicAssessmentProgress(token, {
      expectedRevision: 1,
      questionId: "roofAge",
      responsePatch: {roofAge: "unknown"},
    }, repository);

    expect(result).toMatchObject({
      currentStep: 2,
      revision: 2,
      propertyRevealed: true,
      lastAnsweredAt: expect.any(String),
      responses: {reason: "roof_age", roofAge: "unknown"},
    });
  });

  test("does not advance persisted progress when a save fails", async () => {
    const repository = new MemoryAssessmentRepository();
    await getPublicAssessment(token, repository);
    repository.failNextSave = true;

    await expect(savePublicAssessmentProgress(token, {
      expectedRevision: 0,
      questionId: "reason",
      responsePatch: {reason: "known_replacement"},
    }, repository)).rejects.toThrow("persistence unavailable");
    expect(repository.assessment).toMatchObject({
      currentStep: 0,
      lastAnsweredAt: null,
      responses: {},
    });
  });

  test("emits high intent once when progressive answers first cross the threshold", async () => {
    const repository = new MemoryAssessmentRepository();
    const input = {
      expectedRevision: 0,
      questionId: "reason",
      responsePatch: {reason: "known_replacement" as const},
    };

    await savePublicAssessmentProgress(token, input, repository);
    await expect(savePublicAssessmentProgress(token, input, repository)).rejects.toMatchObject({
      status: 409,
      state: {revision: 1, responses: {reason: "known_replacement"}},
    });

    expect([...repository.lifecycleEvents]).toEqual([
      "roof/assessment.high_intent:55555555-5555-4555-8555-555555555555",
    ]);
  });

  test("rejects unrecognized partial response keys", async () => {
    await expect(savePublicAssessmentProgress(token, {
      expectedRevision: 0,
      questionId: "reason",
      responsePatch: {leadScore: 99} as never,
    }, new MemoryAssessmentRepository())).rejects.toEqual(
      expect.objectContaining<Partial<PublicAssessmentError>>({status: 400}),
    );
  });

  test("derives scores on completion without exposing them publicly", async () => {
    const repository = new MemoryAssessmentRepository();
    seedFinalStep(repository);
    const result = await completePublicAssessment(token, {
      expectedRevision: 0,
      responsePatch: {ownership: "owner"},
    }, repository);

    expect(result).toMatchObject({
      status: "completed",
      recommendation: "replacement_may_make_sense",
    });
    expect(result).not.toHaveProperty("scores");
    expect(repository.completion).toMatchObject({
      recommendation: "replacement_may_make_sense",
      scores: {need: 17, urgency: 6},
      assessmentVersion: "roof-check-v1",
      signals: {complete: true, highIntent: true},
    });
    expect([...repository.lifecycleEvents]).toEqual([
      "roof/assessment.high_intent:55555555-5555-4555-8555-555555555555",
      "roof/assessment.completed:55555555-5555-4555-8555-555555555555",
    ]);
  });

  test("completion retries do not duplicate lifecycle events", async () => {
    const repository = new MemoryAssessmentRepository();
    seedFinalStep(repository);

    await completePublicAssessment(token, {expectedRevision: 0, responsePatch: {ownership: "owner"}}, repository);
    await completePublicAssessment(token, {expectedRevision: 0, responsePatch: {ownership: "owner"}}, repository);

    expect(repository.lifecycleEvents.size).toBe(2);
  });

  test("does not overwrite a completed assessment", async () => {
    const repository = new MemoryAssessmentRepository();
    seedFinalStep(repository);
    await completePublicAssessment(token, {expectedRevision: 0, responsePatch: {ownership: "owner"}}, repository);

    await expect(savePublicAssessmentProgress(token, {
      expectedRevision: 1,
      questionId: "roofAge",
      responsePatch: {roofAge: "under_5"},
    }, repository)).rejects.toEqual(
      expect.objectContaining<Partial<PublicAssessmentError>>({status: 409}),
    );
  });

  test("rejects a delayed stale save without changing canonical answers, step, or revision", async () => {
    const repository = new MemoryAssessmentRepository();
    await savePublicAssessmentProgress(token, {
      expectedRevision: 0,
      questionId: "reason",
      responsePatch: {reason: "planning"},
    }, repository);
    await savePublicAssessmentProgress(token, {
      expectedRevision: 1,
      questionId: "roofAge",
      responsePatch: {roofAge: "20_plus"},
    }, repository);

    await expect(savePublicAssessmentProgress(token, {
      expectedRevision: 0,
      questionId: "reason",
      responsePatch: {reason: "roof_age"},
    }, repository)).rejects.toMatchObject({status: 409});
    expect(repository.assessment).toMatchObject({
      revision: 2,
      currentStep: 2,
      responses: {reason: "planning", roofAge: "20_plus"},
    });
  });

  test("rejects a future-step jump before persistence", async () => {
    const repository = new MemoryAssessmentRepository();
    await getPublicAssessment(token, repository);
    const before = structuredClone(repository.assessment);

    await expect(savePublicAssessmentProgress(token, {
      expectedRevision: 0,
      questionId: "timeline",
      responsePatch: {timeline: "asap"},
    }, repository)).rejects.toMatchObject({
      status: 409,
      state: {currentStep: 0, revision: 0},
    });
    expect(repository.assessment).toEqual(before);
  });
});
