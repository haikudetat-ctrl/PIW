import type {RoofAssessmentQuestionId, RoofAssessmentResponses} from "@/domain/roof-assessment";
import type {PublicAssessmentState} from "@/modules/roof-assessment/public-assessment";
import {browserChatApi, type ChatApi} from "../chat/[token]/chat-api";

/** What the post-booking questions need from the saved assessment. */
export type AssessmentSnapshot = Pick<PublicAssessmentState, "revision" | "status" | "currentStep" | "responses">;

export type SaveAnswerResult =
  | {kind: "saved"; assessment: AssessmentSnapshot}
  | {kind: "conflict"; assessment: AssessmentSnapshot | null}
  | {kind: "failed"};

/**
 * Every call the fast quote makes, all on PIW's existing public estimate
 * endpoints, scoped by the estimate token (then the booking link it hands out).
 * The price, booking and callback calls are the quote chat's own.
 */
export type FastQuoteApi = Pick<ChatApi, "loadEstimate" | "bookingLink" | "bookingOverview" | "book" | "requestCallback"> & {
  saveOwnership(estimateToken: string, ownership: RoofAssessmentResponses["ownership"]): Promise<boolean>;
  loadAssessment(estimateToken: string): Promise<AssessmentSnapshot | null>;
  /** One question's answer; the last one (`complete`) finishes the assessment. */
  saveAnswer(estimateToken: string, input: {
    expectedRevision: number;
    questionId: RoofAssessmentQuestionId;
    responsePatch: Partial<RoofAssessmentResponses>;
    complete: boolean;
  }): Promise<SaveAnswerResult>;
};

const json = {"content-type": "application/json"};
const enc = encodeURIComponent;

function snapshot(body: unknown): AssessmentSnapshot | null {
  const value = body as Partial<AssessmentSnapshot> | null;
  return value && typeof value.revision === "number" && typeof value.currentStep === "number"
    && typeof value.status === "string" && value.responses && typeof value.responses === "object"
    ? {revision: value.revision, status: value.status, currentStep: value.currentStep, responses: value.responses}
    : null;
}

export const browserFastQuoteApi: FastQuoteApi = {
  loadEstimate: browserChatApi.loadEstimate,
  bookingLink: browserChatApi.bookingLink,
  bookingOverview: browserChatApi.bookingOverview,
  book: browserChatApi.book,
  requestCallback: browserChatApi.requestCallback,
  async saveOwnership(estimateToken, ownership) {
    const response = await fetch(`/api/roof-estimate/${enc(estimateToken)}/ownership`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ownership}),
    }).catch(() => null);
    return Boolean(response?.ok);
  },
  async loadAssessment(estimateToken) {
    const response = await fetch(`/api/roof-estimate/${enc(estimateToken)}/assessment`, {cache: "no-store"}).catch(() => null);
    return response?.ok ? snapshot(await response.json().catch(() => null)) : null;
  },
  async saveAnswer(estimateToken, {expectedRevision, questionId, responsePatch, complete}) {
    const response = await fetch(`/api/roof-estimate/${enc(estimateToken)}/assessment`, {
      method: complete ? "POST" : "PATCH",
      headers: json,
      body: JSON.stringify(complete
        ? {expectedRevision, responsePatch}
        : {expectedRevision, questionId, responsePatch}),
    }).catch(() => null);
    if (response?.ok) {
      const saved = snapshot(await response.json().catch(() => null));
      return saved ? {kind: "saved", assessment: saved} : {kind: "failed"};
    }
    if (response?.status === 409) return {kind: "conflict", assessment: snapshot(await response.json().catch(() => null))};
    return {kind: "failed"};
  },
};
