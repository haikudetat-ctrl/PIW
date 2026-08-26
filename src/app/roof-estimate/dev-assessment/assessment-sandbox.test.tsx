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
  test("the consultation action does not restart the loading flow", () => {
    render(<AssessmentSandbox />);
    fireEvent.click(screen.getByRole("button", {name: "Finish demo assessment"}));

    fireEvent.click(screen.getByRole("button", {name: "Review my roof with a specialist"}));
    expect(screen.getByRole("group", {name: "How should we follow up?"})).toBeVisible();
    expect(screen.queryByRole("button", {name: "Finish demo assessment"})).not.toBeInTheDocument();
  });
});
