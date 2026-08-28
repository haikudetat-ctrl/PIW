import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import type {RoofAssessmentResponses} from "@/domain/roof-assessment";

const completedResponses: RoofAssessmentResponses = {
  reason: "known_replacement",
  roofAge: "20_plus",
  conditionSignals: ["curling_or_cracking", "missing_shingles"],
  roofVisible: "yes",
  visibleCondition: "heavy_wear",
  stories: "two",
  complexityFeatures: ["multiple_levels"],
  priority: "long_warranty",
  timeline: "this_season",
  ownership: "owner",
};
const previewAerial = "/campaigns/seasonal-shield/hero.webp";

vi.mock("../[token]/assessment-experience", () => ({
  AssessmentExperience: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));

vi.mock("../[token]/assessment-questionnaire", () => ({
  AssessmentQuestionnaire: ({
    onPreviewComplete,
  }: {
    onPreviewComplete: (responses: RoofAssessmentResponses) => void;
  }) => (
    <button type="button" onClick={() => onPreviewComplete(completedResponses)}>
      Finish demo assessment
    </button>
  ),
}));

const {AssessmentSandbox, createPreviewAerialLoader} = await import("./assessment-sandbox");

describe("development assessment sandbox", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, "", "/roof-estimate/dev-assessment");
    vi.unstubAllGlobals();
  });

  test("provides deterministic ready, slow, retry, and pending imagery fixtures", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;

    await expect(createPreviewAerialLoader("ready")({
      imageSrc: previewAerial,
      signal,
    })).resolves.toEqual({kind: "ready", objectUrl: previewAerial});

    let slowResolved = false;
    const slow = createPreviewAerialLoader("slow")({
      imageSrc: previewAerial,
      signal,
    }).then((result) => {
      slowResolved = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(8_999);
    expect(slowResolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(slow).resolves.toEqual({
      kind: "ready",
      objectUrl: previewAerial,
    });

    const retryThenReady = createPreviewAerialLoader("retry");
    await expect(retryThenReady({imageSrc: previewAerial, signal}))
      .resolves.toEqual({kind: "retry", delayMs: 2_500});
    await expect(retryThenReady({imageSrc: previewAerial, signal}))
      .resolves.toEqual({kind: "ready", objectUrl: previewAerial});

    const pending = createPreviewAerialLoader("pending");
    await expect(pending({imageSrc: previewAerial, signal}))
      .resolves.toEqual({kind: "retry", delayMs: 2_500});
    await expect(pending({imageSrc: previewAerial, signal}))
      .resolves.toEqual({kind: "retry", delayMs: 2_500});
  });

  test("the consultation action does not restart the loading flow", () => {
    render(<AssessmentSandbox />);
    fireEvent.click(screen.getByRole("button", {name: "Finish demo assessment"}));

    fireEvent.click(screen.getByRole("button", {name: "Review my roof with a specialist"}));
    expect(screen.getByRole("group", {name: "How should we follow up?"})).toBeVisible();
    expect(screen.queryByRole("button", {name: "Finish demo assessment"})).not.toBeInTheDocument();
  });

  test.each([
    ["pending", "Finalizing your property calculation"],
    ["review_required", "A professional is reviewing the property"],
  ])("previews the %s result state without an invented range", (state, expected) => {
    window.history.replaceState({}, "", `/roof-estimate/dev-assessment?result=${state}`);

    render(<AssessmentSandbox />);

    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.queryByText("$18,000")).not.toBeInTheDocument();
  });

  test("previews a Google-derived ready result with campaign-specific framing", () => {
    window.history.replaceState(
      {},
      "",
      "/roof-estimate/dev-assessment?result=ready&presentation=weather-report",
    );

    render(<AssessmentSandbox />);

    expect(screen.getByRole("heading", {name: "Your roof weather outlook"})).toBeVisible();
    expect(screen.getByText("$18,000")).toBeVisible();
    expect(screen.getByText("$26,000")).toBeVisible();
    expect(screen.getByText(/23\.0 measured roofing squares/)).toBeVisible();
  });

  test("query-controlled consultation success returns the selected canonical preference", async () => {
    window.history.replaceState(
      {},
      "",
      "/roof-estimate/dev-assessment?result=pending&consultation=success",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected request")));

    render(<AssessmentSandbox />);
    fireEvent.click(screen.getByRole("button", {name: /review.*specialist/i}));
    fireEvent.click(screen.getByRole("radio", {name: "Text me"}));
    fireEvent.click(screen.getByRole("button", {name: "Request my consultation"}));

    expect(await screen.findByText("Preference saved")).toBeVisible();
    expect(screen.getByText("We’ll follow up by text.")).toBeVisible();
  });

  test("query-controlled consultation failure preserves the selected choice", async () => {
    window.history.replaceState(
      {},
      "",
      "/roof-estimate/dev-assessment?result=review_required&consultation=error",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected request")));

    render(<AssessmentSandbox />);
    fireEvent.click(screen.getByRole("button", {name: /review.*specialist/i}));
    const email = screen.getByRole("radio", {name: "Email me"});
    fireEvent.click(email);
    fireEvent.click(screen.getByRole("button", {name: "Request my consultation"}));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not save your preference. Please try again.",
    );
    await waitFor(() => expect(email).toBeChecked());
  });
});
