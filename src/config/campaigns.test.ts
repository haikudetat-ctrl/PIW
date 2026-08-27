import { describe, expect, test } from "vitest";
import { campaignSlugs, campaigns, getCampaign } from "./campaigns";

describe("campaign registry", () => {
  test("has a complete definition for every public campaign slug", () => {
    for (const slug of campaignSlugs) {
      expect(campaigns[slug]).toMatchObject({ slug });
      expect(campaigns[slug].driveFolderUrl).toMatch(/^https:\/\/drive\.google\.com\/drive\/folders\//);
      expect(campaigns[slug].image).toMatch(/^\//);
    }
  });

  test("rejects unknown campaign slugs", () => {
    expect(getCampaign("not-a-campaign")).toBeUndefined();
  });
});
