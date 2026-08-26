import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RoofAssessmentResponses } from "@/domain/roof-assessment";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({useRouter: () => ({refresh})}));

const {AssessmentQuestionnaire} = await import("./assessment-questionnaire");

const token = "11111111-1111-4111-8111-111111111111";
const completeExceptOwnership: Partial<RoofAssessmentResponses> = {
  reason: "planning",
  roofAge: "unknown",
  conditionSignals: ["unsure"],
  roofVisible: "no",
  visibleCondition: "not_answered",
  stories: "unknown",
  complexityFeatures: ["none_or_unsure"],
  priority: "understand_options",
  timeline: "researching",
};

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("roof assessment questionnaire", () => {
  test("saves the homeowner's reason before moving forward", async () => {
    const fetch = vi.fn(async () => Response.json({currentStep: 1}));
    vi.stubGlobal("fetch", fetch);
    render(<AssessmentQuestionnaire token={token} initialStep={0} initialResponses={{}} />);

    fireEvent.click(screen.getByRole("button", {name: "I noticed a leak"}));
    expect(screen.getByText(/doesn't automatically mean/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/roof-estimate/${token}/assessment`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          currentStep: 1,
          responses: {reason: "active_leak"},
        }),
      }),
    ));
    expect(await screen.findByRole("heading", {name: "About how old do you think the roof is?"})).toBeVisible();
  });

  test("moves through questions without API calls in the development preview", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<AssessmentQuestionnaire preview token={token} initialStep={0} initialResponses={{}} />);

    fireEvent.click(screen.getByRole("button", {name: "Just planning ahead"}));
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));

    expect(screen.getByRole("heading", {name: "About how old do you think the roof is?"})).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("treats no idea as a useful roof-age answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({currentStep: 2})));
    render(<AssessmentQuestionnaire token={token} initialStep={1} initialResponses={{reason: "planning"}} />);

    fireEvent.click(screen.getByRole("button", {name: "No idea"}));

    expect(screen.getByText(/Most homeowners don't know/)).toBeVisible();
    expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
  });

  test("keeps exclusive condition answers from contradicting damage signals", () => {
    render(<AssessmentQuestionnaire token={token} initialStep={2} initialResponses={{
      reason: "planning",
      roofAge: "unknown",
    }} />);

    fireEvent.click(screen.getByRole("button", {name: "Active leak"}));
    fireEvent.click(screen.getByRole("button", {name: "Nothing obvious"}));

    expect(screen.getByRole("button", {name: "Nothing obvious"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name: "Active leak"})).toHaveAttribute("aria-pressed", "false");
  });

  test("clears either exclusive condition answer when a damage signal is selected", () => {
    render(<AssessmentQuestionnaire token={token} initialStep={2} initialResponses={{
      reason: "planning",
      roofAge: "unknown",
    }} />);

    fireEvent.click(screen.getByRole("button", {name: "Not sure"}));
    fireEvent.click(screen.getByRole("button", {name: "Active leak"}));

    expect(screen.getByRole("button", {name: "Not sure"})).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", {name: "Active leak"})).toHaveAttribute("aria-pressed", "true");
  });

  test("resumes at the saved step with prior answers intact", () => {
    render(<AssessmentQuestionnaire token={token} initialStep={7} initialResponses={{
      ...completeExceptOwnership,
      timeline: undefined,
    }} />);

    expect(screen.getByRole("heading", {name: "How soon would you want to deal with it if work is needed?"})).toBeVisible();
    expect(screen.getByText("Question 8 of 9")).toBeVisible();
  });

  test("retains the selected answer when a partial save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503})));
    render(<AssessmentQuestionnaire token={token} initialStep={0} initialResponses={{}} />);

    fireEvent.click(screen.getByRole("button", {name: "Just planning ahead"}));
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not save your answer");
    expect(screen.getByRole("button", {name: "Just planning ahead"})).toHaveAttribute("aria-pressed", "true");
  });

  test("completes the assessment on the ownership step and refreshes the result", async () => {
    const fetch = vi.fn(async () => Response.json({
      status: "completed",
      recommendation: "monitor_or_repair",
    }));
    vi.stubGlobal("fetch", fetch);
    render(<AssessmentQuestionnaire
      token={token}
      initialStep={8}
      initialResponses={completeExceptOwnership}
    />);

    fireEvent.click(screen.getByRole("button", {name: "Yes, this is my home"}));
    fireEvent.click(screen.getByRole("button", {name: "See my roof assessment"}));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/roof-estimate/${token}/assessment`,
      expect.objectContaining({method: "POST"}),
    ));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
