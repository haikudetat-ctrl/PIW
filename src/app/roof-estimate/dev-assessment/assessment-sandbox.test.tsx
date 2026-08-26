import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, test, vi} from "vitest";
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

const {AssessmentSandbox} = await import("./assessment-sandbox");

describe("development assessment sandbox", () => {
  test("the exact quote action does not restart the loading flow", () => {
    render(<AssessmentSandbox />);
    fireEvent.click(screen.getByRole("button", {name: "Finish demo assessment"}));

    expect(screen.getByRole("link", {name: "Turn this range into an exact quote"}))
      .toHaveAttribute("href", "tel:+18888325050");
    expect(screen.queryByRole("button", {name: "Finish demo assessment"})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Replay assessment"}));
    expect(screen.getByRole("button", {name: "Finish demo assessment"})).toBeVisible();
  });
});
