import { describe, expect, test } from "vitest";
import type { RoofAssessmentResponses } from "@/domain/roof-assessment";
import type {
  AssessmentCompletion,
  AssessmentProgressPatch,
  PersistedAssessment,
  PublicAssessmentRepository,
  PublicEstimateContext,
} from "@/modules/roof-assessment/public-assessment";
import { handlePublicAssessmentRequest } from "./route";

const token = "11111111-1111-4111-8111-111111111111";
const context: PublicEstimateContext = {
  estimateId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  leadId: "44444444-4444-4444-8444-444444444444",
  campaign: "for-every-season",
  address: "1 Main St, Newark, NJ 07102",
};

const responses: RoofAssessmentResponses = {
  reason: "planning",
  roofAge: "unknown",
  conditionSignals: ["unsure"],
  roofVisible: "no",
  visibleCondition: "not_answered",
  stories: "unknown",
  complexityFeatures: ["none_or_unsure"],
  priority: "understand_options",
  timeline: "researching",
  ownership: "owner",
};

class RouteRepository implements PublicAssessmentRepository {
  assessment: PersistedAssessment = {
    id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress",
    currentStep: 0,
    propertyRevealedAt: null,
    responses: {},
    recommendation: null,
  };

  async findEstimateByToken(value: string) {
    return value === token ? context : null;
  }
  async findOrCreateAssessment(_context: PublicEstimateContext) {
    return this.assessment;
  }
  async saveProgress(_id: string, patch: AssessmentProgressPatch) {
    this.assessment = {
      ...this.assessment,
      currentStep: patch.currentStep,
      propertyRevealedAt: patch.propertyRevealedAt ?? this.assessment.propertyRevealedAt,
      responses: {...this.assessment.responses, ...patch.responses},
    };
    return this.assessment;
  }
  async complete(_id: string, completion: AssessmentCompletion) {
    this.assessment = {
      ...this.assessment,
      status: "completed",
      currentStep: 9,
      responses: completion.responses,
      recommendation: completion.recommendation,
    };
    return this.assessment;
  }
}

describe("public roof assessment route", () => {
  test("GET returns public-safe resumable state", async () => {
    const response = await handlePublicAssessmentRequest({
      method: "GET",
      token,
      repository: new RouteRepository(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      status: "in_progress",
      campaign: "for-every-season",
      propertyRevealed: false,
    }));
  });

  test("rejects a malformed public token", async () => {
    const response = await handlePublicAssessmentRequest({
      method: "GET",
      token: "not-a-token",
      repository: new RouteRepository(),
    });

    expect(response.status).toBe(404);
  });

  test("PATCH validates and saves partial progress", async () => {
    const response = await handlePublicAssessmentRequest({
      method: "PATCH",
      token,
      body: {currentStep: 1, propertyRevealed: true, responses: {reason: "planning"}},
      repository: new RouteRepository(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      currentStep: 1,
      propertyRevealed: true,
      responses: {reason: "planning"},
    }));
  });

  test("PATCH rejects browser-controlled score fields", async () => {
    const response = await handlePublicAssessmentRequest({
      method: "PATCH",
      token,
      body: {currentStep: 1, responses: {scores: {need: 99}}},
      repository: new RouteRepository(),
    });

    expect(response.status).toBe(400);
  });

  test("POST completes the assessment without returning internal scores", async () => {
    const response = await handlePublicAssessmentRequest({
      method: "POST",
      token,
      body: responses,
      repository: new RouteRepository(),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({status: "completed", recommendation: "monitor_or_repair"});
    expect(body).not.toHaveProperty("scores");
  });

  test("returns a stable unavailable response when persistence fails", async () => {
    const repository = new RouteRepository();
    repository.findEstimateByToken = async () => { throw new Error("database down"); };
    const response = await handlePublicAssessmentRequest({method: "GET", token, repository});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({error: "Roof assessment is temporarily unavailable"});
  });
});
