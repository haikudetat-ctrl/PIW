import { describe, expect, test } from "vitest";
import {
  assessmentLoadingStages,
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
    ["do-it-right-once", "A clearer decision starts here."],
    ["weather-report", "See what the seasons may have changed."],
    ["seasonal-shield", "Understand what is protecting your home."],
    ["for-every-season", "A personalized look at your New Jersey roof."],
  ])("selects campaign-aware copy for %s", (campaign, headline) => {
    expect(getRoofAssessmentContext(campaign)).toMatchObject({slug: campaign, headline});
  });

  test("uses For Every Season context for homepage, contact, drawer, and unknown sources", () => {
    expect(getRoofAssessmentContext(null).slug).toBe("for-every-season");
    expect(getRoofAssessmentContext("unknown").slug).toBe("for-every-season");
  });

  test("does not let campaign context alter the assessment stages", () => {
    const contexts = [
      "do-it-right-once",
      "weather-report",
      "seasonal-shield",
      "for-every-season",
    ].map(getRoofAssessmentContext);

    expect(contexts.every((context) => context.loadingStages === assessmentLoadingStages)).toBe(true);
  });
});
