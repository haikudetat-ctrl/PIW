import { describe, expect, test } from "vitest";
import {
  assessmentLoadingStages,
  roofAssessmentEntryContexts,
  roofAssessmentPresentationByCampaign,
  roofAssessmentQuestionIds,
  getRoofAssessmentContext,
} from "./roof-assessment";

describe("roof assessment campaign presentation", () => {
  test("uses the approved restrained loading sequence in every context", () => {
    expect(assessmentLoadingStages).toEqual([
      "Confirming the address",
      "Locating the roof",
      "Reviewing aerial imagery",
      "Preparing the assessment",
    ]);
  });

  test.each([
    ["all-season-main", "A personalized look at your New Jersey roof."],
    ["weather-report", "See what the seasons may have changed."],
    ["seasonal-shield", "Understand what is protecting your home."],
    ["for-every-season", "Built for every New Jersey season."],
  ])("selects campaign-aware copy for %s", (campaign, headline) => {
    expect(getRoofAssessmentContext(campaign)).toMatchObject({key: campaign, headline});
  });

  test("uses the distinct All Season presentation for main entry points and unknown sources", () => {
    expect(getRoofAssessmentContext(null).key).toBe("all-season-main");
    expect(getRoofAssessmentContext("unknown").key).toBe("all-season-main");
    expect(getRoofAssessmentContext("all-season-main")).not.toEqual(
      getRoofAssessmentContext("for-every-season"),
    );
  });

  test("does not let presentation context alter questions, order, or loading stages", () => {
    const contexts = [
      "all-season-main",
      "weather-report",
      "seasonal-shield",
      "for-every-season",
    ].map(getRoofAssessmentContext);

    expect(contexts.every((context) => context.loadingStages === assessmentLoadingStages)).toBe(true);
    expect(contexts.every((context) => context.questionIds === roofAssessmentQuestionIds)).toBe(true);
    expect(roofAssessmentQuestionIds).toEqual([
      "reason",
      "roofAge",
      "conditionSignals",
      "roofVisibility",
      "stories",
      "complexityFeatures",
      "priority",
      "timeline",
      "ownership",
    ]);
  });

  test("exports one exact campaign and entry-point mapping without the retired route", () => {
    expect(roofAssessmentPresentationByCampaign).toEqual({
      "weather-report": "weather-report",
      "seasonal-shield": "seasonal-shield",
      "for-every-season": "for-every-season",
    });
    expect(roofAssessmentEntryContexts).toEqual({
      "main-home": {campaign: null, presentationKey: "all-season-main"},
      "main-contact": {campaign: null, presentationKey: "all-season-main"},
      "main-drawer": {campaign: null, presentationKey: "all-season-main"},
      "roof-estimate": {campaign: null, presentationKey: "all-season-main"},
      "campaign:weather-report": {
        campaign: "weather-report",
        presentationKey: "weather-report",
      },
      "campaign:seasonal-shield": {
        campaign: "seasonal-shield",
        presentationKey: "seasonal-shield",
      },
      "campaign:for-every-season": {
        campaign: "for-every-season",
        presentationKey: "for-every-season",
      },
    });
    expect(getRoofAssessmentContext("do-it-right-once").key).toBe("all-season-main");
  });
});
