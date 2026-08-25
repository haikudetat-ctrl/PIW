import {describe, expect, test} from "vitest";
import {
  campaignSlugs,
  campaignThemeCssVariables,
  campaignThemes,
  neutralCampaignTheme,
  resolveCampaignTheme,
} from "./all-season-campaign-themes";

describe("All Season campaign themes", () => {
  test("defines all four approved campaign journeys", () => {
    expect(Object.keys(campaignThemes)).toEqual(campaignSlugs);
    expect(campaignThemes["do-it-right-once"].loadingStatement).toBe(
      "Building your roof estimate around the facts.",
    );
    expect(campaignThemes["for-every-season"].accent).toBe("#7bcb28");
  });

  test("falls back safely for unknown and non-campaign leads", () => {
    expect(resolveCampaignTheme(null)).toBe(neutralCampaignTheme);
    expect(resolveCampaignTheme("organic")).toBe(neutralCampaignTheme);
  });

  test("exposes the complete CSS variable surface", () => {
    expect(campaignThemeCssVariables(campaignThemes["weather-report"])).toEqual({
      "--estimate-bg": "#082e49",
      "--estimate-surface": "#0c405f",
      "--estimate-text": "#f7fbff",
      "--estimate-muted": "#c9dce8",
      "--estimate-accent": "#ff9a45",
      "--estimate-accent-contrast": "#102a3d",
    });
  });
});
