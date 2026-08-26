import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, test, vi} from "vitest";
import type {RoofAssessmentResponses} from "@/domain/roof-assessment";
import {AssessmentResult} from "./assessment-result";

const responses: RoofAssessmentResponses = {
  reason: "active_leak",
  roofAge: "15_20",
  conditionSignals: ["active_leak", "water_stains"],
  roofVisible: "yes",
  visibleCondition: "moderate_wear",
  stories: "two",
  complexityFeatures: ["garage", "multiple_levels"],
  priority: "reasonable_cost",
  timeline: "asap",
  ownership: "owner",
};

describe("assessment result payoff", () => {
  test("shows a clearly labeled sample range and outlook from the homeowner's answers", () => {
    render(
      <AssessmentResult
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl="/campaigns/every-season.jpg"
        recommendation="professional_inspection"
        responses={responses}
        range={{lowCents: 1_800_000, highCents: 2_600_000, roofSquares: 23, source: "sample"}}
        consultationHref="tel:+18888325050"
      />,
    );

    expect(screen.getByRole("heading", {name: "Worth having inspected."})).toBeVisible();
    expect(screen.getByText("$18,000")).toBeVisible();
    expect(screen.getByText("$26,000")).toBeVisible();
    expect(screen.getByText("Sample range for this development preview")).toBeVisible();
    expect(screen.getByText("Prompt professional review")).toBeVisible();
    expect(screen.getByText(/multiple roof levels and an attached garage/i)).toBeVisible();
  });

  test("uses a consultation link for the primary action and reserves restart for replay", () => {
    const onReplay = vi.fn();
    render(
      <AssessmentResult
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl="/campaigns/every-season.jpg"
        recommendation="replacement_may_make_sense"
        responses={responses}
        range={{lowCents: 1_800_000, highCents: 2_600_000, roofSquares: 23, source: "sample"}}
        consultationHref="tel:+18888325050"
        onReplay={onReplay}
      />,
    );

    expect(screen.getByRole("link", {name: "Turn this range into an exact quote"}))
      .toHaveAttribute("href", "tel:+18888325050");
    expect(onReplay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Replay assessment"}));
    expect(onReplay).toHaveBeenCalledOnce();
  });

  test("keeps the outlook visible while the property calculation is pending", () => {
    render(
      <AssessmentResult
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl="/campaigns/every-season.jpg"
        recommendation="professional_inspection"
        responses={responses}
        range={null}
        consultationHref="tel:+18888325050"
      />,
    );

    expect(screen.getByText("Finalizing your property calculation")).toBeVisible();
    expect(screen.getByText("Prompt professional review")).toBeVisible();
  });
});
