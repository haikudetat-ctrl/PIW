import { describe, expect, test } from "vitest";
import type {
  AssessmentOwnershipAnswer,
  PersistedAssessment,
  PublicAssessmentOwnershipRepository,
  PublicEstimateContext,
} from "@/modules/roof-assessment/public-assessment";
import { handleOwnershipRequest } from "./route";

const token = "11111111-1111-4111-8111-111111111111";
const context: PublicEstimateContext = {
  estimateId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  leadId: "44444444-4444-4444-8444-444444444444",
  campaign: null,
  address: "1 Main St, Newark, NJ 07102",
};

// A value-first lead after conversion: the preview answers are seeded and the
// step pointer sits after the first two questions.
function seeded(overrides: Partial<PersistedAssessment> = {}): PersistedAssessment {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress",
    revision: 3,
    currentStep: 2,
    propertyRevealedAt: "2026-10-23T12:00:00.000Z",
    lastAnsweredAt: null,
    responses: {reason: "roof_age", roofAge: "15_20", timeline: "this_season"},
    recommendation: null,
    ...overrides,
  };
}

class OwnershipRepository implements PublicAssessmentOwnershipRepository {
  saves: AssessmentOwnershipAnswer[] = [];
  conflicts = 0;
  constructor(public assessment: PersistedAssessment = seeded()) {}

  async findEstimateByToken(value: string) {
    return value === token ? context : null;
  }
  async findOrCreateAssessment() {
    return this.assessment;
  }
  async saveOwnership(_id: string, answer: AssessmentOwnershipAnswer) {
    this.saves.push(answer);
    if (this.conflicts > 0) {
      this.conflicts -= 1;
      this.assessment = {...this.assessment, revision: this.assessment.revision + 1};
      return {assessment: this.assessment, applied: false};
    }
    this.assessment = {
      ...this.assessment,
      revision: this.assessment.revision + 1,
      responses: {...this.assessment.responses, ownership: answer.ownership},
    };
    return {assessment: this.assessment, applied: true};
  }
}

describe("ownership answer", () => {
  test("saves the answer without moving the step pointer", async () => {
    const repository = new OwnershipRepository();
    const response = await handleOwnershipRequest({token, body: {ownership: "owner"}, repository});
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state.responses.ownership).toBe("owner");
    expect(state.currentStep).toBe(2);
    expect(repository.saves).toEqual([expect.objectContaining({
      companyId: context.companyId,
      expectedRevision: 3,
      ownership: "owner",
    })]);
  });

  test("retries once when another tab saved first", async () => {
    const repository = new OwnershipRepository();
    repository.conflicts = 1;
    const response = await handleOwnershipRequest({token, body: {ownership: "not_owner"}, repository});
    expect(response.status).toBe(200);
    expect(repository.saves.map((save) => save.expectedRevision)).toEqual([3, 4]);
  });

  test("leaves a completed assessment alone", async () => {
    const repository = new OwnershipRepository(seeded({status: "completed", currentStep: 9}));
    const response = await handleOwnershipRequest({token, body: {ownership: "owner"}, repository});
    expect(response.status).toBe(200);
    expect(repository.saves).toEqual([]);
  });

  test("does not write the same answer twice", async () => {
    const repository = new OwnershipRepository(seeded({responses: {ownership: "buying"}}));
    await handleOwnershipRequest({token, body: {ownership: "buying"}, repository});
    expect(repository.saves).toEqual([]);
  });

  test("refuses an abandoned assessment, an unknown answer, and an unknown token", async () => {
    const abandoned = new OwnershipRepository(seeded({status: "abandoned"}));
    expect((await handleOwnershipRequest({token, body: {ownership: "owner"}, repository: abandoned})).status).toBe(409);
    const repository = new OwnershipRepository();
    expect((await handleOwnershipRequest({token, body: {ownership: "renter"}, repository})).status).toBe(400);
    expect((await handleOwnershipRequest({token, body: {ownership: "owner", extra: 1}, repository})).status).toBe(400);
    expect((await handleOwnershipRequest({token: "not-a-token", body: {ownership: "owner"}, repository})).status).toBe(404);
    expect((await handleOwnershipRequest({
      token: "99999999-9999-4999-8999-999999999999",
      body: {ownership: "owner"},
      repository,
    })).status).toBe(404);
  });
});
