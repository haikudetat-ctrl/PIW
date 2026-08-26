import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {roofAssessmentQuestionSteps, type RoofAssessmentResponses} from "@/domain/roof-assessment";

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

beforeEach(() => vi.stubGlobal("scrollTo", vi.fn()));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("roof assessment questionnaire", () => {
  test("renders the shared nine-step model in its canonical order", () => {
    expect(roofAssessmentQuestionSteps.map((step) => step.id)).toEqual([
      "reason", "roofAge", "conditionSignals", "roofVisibility", "stories",
      "complexityFeatures", "priority", "timeline", "ownership",
    ]);
    const expectedTitles = [
      "What made you check your roof today?",
      "About how old do you think the roof is?",
      "Have you noticed any of these?",
      "Can you see your roof from the ground?",
      "Quick property check",
      "Any sections like these?",
      "What would make the project feel like the right decision?",
      "How soon would a professional review be useful?",
      "What is your role with this property?",
    ];

    expectedTitles.forEach((title, initialStep) => {
      const view = render(<AssessmentQuestionnaire
        preview
        token={token}
        initialStep={initialStep}
        initialResponses={{}}
      />);
      expect(screen.getByRole("heading", {name: title})).toBeVisible();
      view.unmount();
    });
  });

  test("saves the homeowner's reason before moving forward", async () => {
    const fetch = vi.fn(async () => Response.json({currentStep: 1, revision: 1, responses: {reason: "active_leak"}}));
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
          expectedRevision: 0,
          questionId: "reason",
          responsePatch: {reason: "active_leak"},
        }),
      }),
    ));
    expect(await screen.findByRole("heading", {name: "About how old do you think the roof is?"})).toBeVisible();
  });

  test("moves through questions without API calls in the development preview", () => {
    const fetch = vi.fn();
    const scrollTo = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("scrollTo", scrollTo);
    render(<AssessmentQuestionnaire preview token={token} initialStep={0} initialResponses={{}} />);

    fireEvent.click(screen.getByRole("button", {name: "Just planning ahead"}));
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));

    expect(screen.getByRole("heading", {name: "About how old do you think the roof is?"})).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({top: 0, behavior: "smooth"});
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

    expect(screen.getByRole("heading", {name: "How soon would a professional review be useful?"})).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "9");
  });

  test("keeps the confirmed property visible while the homeowner answers", () => {
    render(
      <AssessmentQuestionnaire
        preview
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl="/campaigns/every-season.jpg"
        initialStep={0}
        initialResponses={{}}
      />,
    );

    expect(screen.getByText("1 Main St, Newark, NJ 07102")).toBeVisible();
    expect(screen.getByAltText("Confirmed property at 1 Main St, Newark, NJ 07102")).toBeVisible();
  });

  test("uses a meaningful progress description instead of mechanical question labels", () => {
    render(<AssessmentQuestionnaire preview token={token} initialStep={0} initialResponses={{}} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Understanding what brought you here, 1 of 9",
    );
    expect(screen.queryByText("Question 1 of 9")).not.toBeInTheDocument();
    expect(screen.queryByText("Step 01")).not.toBeInTheDocument();
  });

  test("keeps the question controls in a dedicated navigation region", () => {
    render(<AssessmentQuestionnaire preview token={token} initialStep={0} initialResponses={{}} />);

    const controls = screen.getByRole("navigation", {name: "Assessment controls"});
    expect(controls).toContainElement(screen.getByRole("button", {name: "Back"}));
    expect(controls).toContainElement(screen.getByRole("button", {name: "Continue"}));
  });

  test("marks dense answer sets for a screen-fit mobile bento", () => {
    render(<AssessmentQuestionnaire
      preview
      token={token}
      initialStep={2}
      initialResponses={{reason: "planning", roofAge: "unknown"}}
    />);

    const choices = screen.getByRole("group", {name: "Select all that apply"});
    expect(choices).toHaveAttribute("data-option-count", "9");
    expect(choices).toHaveAttribute("data-columns", "two");
    expect(choices).toHaveAttribute("data-density", "compact");
  });

  test("retains the selected answer when a partial save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503})));
    render(<AssessmentQuestionnaire token={token} initialStep={0} initialResponses={{}} />);

    fireEvent.click(screen.getByRole("button", {name: "Just planning ahead"}));
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not save your answer");
    expect(screen.getByRole("button", {name: "Just planning ahead"})).toHaveAttribute("aria-pressed", "true");
  });

  test("retains the losing tab's selected answer while reconciling a canonical revision conflict", async () => {
    const fetch = vi.fn(async () => Response.json({
      status: "in_progress",
      revision: 2,
      currentStep: 1,
      responses: {reason: "planning"},
    }, {status: 409}));
    vi.stubGlobal("fetch", fetch);
    render(<AssessmentQuestionnaire
      token={token}
      initialRevision={1}
      initialStep={0}
      initialResponses={{}}
    />);

    fireEvent.click(screen.getByRole("button", {name: "Roof is getting old"}));
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("updated in another tab");
    expect(screen.getByRole("button", {name: "Roof is getting old"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name: "Try again"})).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("completes the assessment on the ownership step and refreshes the result", async () => {
    const fetch = vi.fn(async () => Response.json({
      status: "completed",
      revision: 1,
      recommendation: "monitor_or_repair",
    }));
    vi.stubGlobal("fetch", fetch);
    render(<AssessmentQuestionnaire
      token={token}
      initialStep={8}
      initialRevision={0}
      initialResponses={completeExceptOwnership}
    />);

    fireEvent.click(screen.getByRole("button", {name: "Yes, this is my home"}));
    fireEvent.click(screen.getByRole("button", {name: "See my roof assessment"}));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/roof-estimate/${token}/assessment`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedRevision: 0,
          responsePatch: {ownership: "owner"},
        }),
      }),
    ));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
