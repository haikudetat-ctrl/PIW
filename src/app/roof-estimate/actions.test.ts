import { describe, expect, test, vi } from "vitest";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import type { StartAssessmentInput } from "@/modules/roof-assessment/start-or-resume";
import {
  executePublicRoofEstimateAction,
  handlePublicRoofEstimateSubmission,
  type PublicRoofEstimateActionDependencies,
} from "./submission";

const submissionId = "11111111-1111-4111-8111-111111111111";
const companyId = "99999999-9999-4999-8999-999999999999";
const submittedAt = new Date("2026-08-26T21:00:00.000Z");
const referrer = "https://piw.example/campaigns/weather-report?utm_source=facebook&utm_campaign=storm&fbclid=click-123";

function validFormData() {
  const data = new FormData();
  Object.entries({
    campaign: "weather-report",
    name: "Jordan Homeowner",
    phone: "609-555-0100",
    email: "jordan@example.com",
    addressMode: "google",
    googlePlaceId: "ChIJ-selected",
    selectedAddress: "132 Windsor Ave, Haddon Township, NJ 08108, USA",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "NJ",
    postalCode: "",
    consentEstimate: "on",
    consentEmail: "on",
    consentSms: "on",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

function dependencies(
  startAssessment: (input: StartAssessmentInput) => Promise<
    | {kind: "continue"; continuationPath: `/roof-estimate/continue/${string}`}
    | {kind: "duplicate_requires_restart"}
  >,
) {
  return {
    prepare: async () => ({companyId, startAssessment}),
    requestHeaders: async () => new Headers({
      referer: referrer,
      "user-agent": "homeowner-browser",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    }),
    createSubmissionId: () => submissionId,
    now: () => submittedAt,
    logFailure: vi.fn(),
  } satisfies PublicRoofEstimateActionDependencies;
}

describe("public roof estimate server action", () => {
  test("invokes the canonical service exactly once with complete evidence", async () => {
    const startAssessment = vi.fn(async () => ({
      kind: "continue" as const,
      continuationPath: "/roof-estimate/continue/safe_token" as const,
    }));

    const outcome = await handlePublicRoofEstimateSubmission(
      validFormData(),
      dependencies(startAssessment),
    );

    expect(outcome).toEqual({
      kind: "redirect",
      continuationPath: "/roof-estimate/continue/safe_token",
    });
    expect(startAssessment).toHaveBeenCalledOnce();
    expect(startAssessment).toHaveBeenCalledWith({
      submissionId,
      companyId,
      name: "Jordan Homeowner",
      email: "jordan@example.com",
      phone: "609-555-0100",
      submittedAddress: "132 Windsor Ave, Haddon Township, NJ 08108, USA",
      googlePlaceId: "ChIJ-selected",
      campaign: "weather-report",
      presentationKey: "weather-report",
      entryPoint: "campaign:weather-report",
      attribution: {
        utm_source: "facebook",
        utm_medium: null,
        utm_campaign: "storm",
        utm_term: null,
        utm_content: null,
        fbclid: "click-123",
        fbp: null,
        fbc: null,
      },
      referrer,
      consent: {
        disclosureVersion: "roof-estimate-v1",
        ipAddress: "203.0.113.10",
        userAgent: "homeowner-browser",
        grantedAt: "2026-08-26T21:00:00.000Z",
      },
    });
  });

  test("returns a safe restart state for a duplicate without a redirect path", async () => {
    const outcome = await handlePublicRoofEstimateSubmission(
      validFormData(),
      dependencies(async () => ({kind: "duplicate_requires_restart"})),
    );

    expect(outcome).toEqual({
      kind: "state",
      state: {error: "Please refresh the page and restart your estimate request."},
    });
    expect(outcome).not.toHaveProperty("continuationPath");
  });

  test("rejects an unsafe continuation path before navigation", async () => {
    const actionDependencies = dependencies(async () => ({
      kind: "continue",
      continuationPath: "/roof-estimate/continue/safe?leak=secret" as `/roof-estimate/continue/${string}`,
    }));

    const outcome = await handlePublicRoofEstimateSubmission(
      validFormData(),
      actionDependencies,
    );

    expect(outcome).toEqual({
      kind: "state",
      state: {error: "We could not start the estimate right now. Please try again."},
    });
    expect(actionDependencies.logFailure).toHaveBeenCalledWith("StartAssessmentInternalError");
  });

  test("lets the real Next redirect error escape because navigation runs outside intake error handling", async () => {
    const startAssessment = vi.fn(async () => ({
      kind: "continue" as const,
      continuationPath: "/roof-estimate/continue/safe_token" as const,
    }));
    const navigate = vi.fn((path: string): never => redirect(path));
    let thrown: unknown;
    try {
      await executePublicRoofEstimateAction(
        validFormData(),
        dependencies(startAssessment),
        navigate,
      );
    } catch (error) {
      thrown = error;
    }

    expect(isRedirectError(thrown)).toBe(true);
    expect(startAssessment).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/roof-estimate/continue/safe_token");
  });
});
