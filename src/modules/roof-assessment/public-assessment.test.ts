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

class MemoryAssessmentRepository implements PublicAssessmentRepository {
  assessment: PersistedAssessment | null = null;
  completion: AssessmentCompletion | null = null;

  async findEstimateByToken(value: string) {
    return value === token ? context : null;
  }

  async findOrCreateAssessment(_context: PublicEstimateContext) {
    this.assessment ??= {
      id: "55555555-5555-4555-8555-555555555555",
      status: "in_progress",
      currentStep: 0,
      propertyRevealedAt: null,
      responses: {},
      recommendation: null,
    };
    return this.assessment;
  }

  async saveProgress(_assessmentId: string, patch: AssessmentProgressPatch) {
    const current = await this.findOrCreateAssessment(context);
    this.assessment = {
      ...current,
      currentStep: patch.currentStep,
      propertyRevealedAt: patch.propertyRevealedAt ?? current.propertyRevealedAt,
      responses: {...current.responses, ...patch.responses},
    };
    return this.assessment;
  }

  async complete(_assessmentId: string, completion: AssessmentCompletion) {
    const current = await this.findOrCreateAssessment(context);
    this.completion = completion;
    this.assessment = {
      ...current,
      status: "completed",
      currentStep: 9,
      responses: completion.responses,
      recommendation: completion.recommendation,
    };
    return this.assessment;
  }
}

describe("public roof assessment", () => {
  test("creates and returns public-safe state for a valid estimate token", async () => {
    const result = await getPublicAssessment(token, new MemoryAssessmentRepository());

    expect(result).toEqual({
      status: "in_progress",
      currentStep: 0,
      propertyRevealed: false,
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
    const result = await savePublicAssessmentProgress(token, {
      currentStep: 2,
      propertyRevealed: true,
      responses: {reason: "roof_age", roofAge: "unknown"},
    }, repository);

    expect(result).toMatchObject({
      currentStep: 2,
      propertyRevealed: true,
      responses: {reason: "roof_age", roofAge: "unknown"},
    });
  });

  test("rejects unrecognized partial response keys", async () => {
    await expect(savePublicAssessmentProgress(token, {
      currentStep: 1,
      responses: {leadScore: 99} as never,
    }, new MemoryAssessmentRepository())).rejects.toEqual(
      expect.objectContaining<Partial<PublicAssessmentError>>({status: 400}),
    );
  });

  test("derives scores on completion without exposing them publicly", async () => {
    const repository = new MemoryAssessmentRepository();
    const result = await completePublicAssessment(token, completeResponses, repository);

    expect(result).toMatchObject({
      status: "completed",
      recommendation: "replacement_may_make_sense",
    });
    expect(result).not.toHaveProperty("scores");
    expect(repository.completion).toMatchObject({
      recommendation: "replacement_may_make_sense",
      scores: {need: 17, urgency: 6},
      assessmentVersion: "roof-check-v1",
    });
  });

  test("does not overwrite a completed assessment", async () => {
    const repository = new MemoryAssessmentRepository();
    await completePublicAssessment(token, completeResponses, repository);

    await expect(savePublicAssessmentProgress(token, {
      currentStep: 3,
      responses: {roofAge: "under_5"},
    }, repository)).rejects.toEqual(
      expect.objectContaining<Partial<PublicAssessmentError>>({status: 409}),
    );
  });
});
