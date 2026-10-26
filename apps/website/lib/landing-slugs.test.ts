import {describe, expect, test} from "vitest";
import {landingEntryPoints, landingSlugFromPath, landingSlugs} from "./landing-slugs";

describe("landing slugs", () => {
  test("include the Meta campaigns and the Google search pages", () => {
    expect(landingSlugs).toEqual(expect.arrayContaining([
      "weather-report",
      "roof-replacement",
      "roof-replacement-cost",
      "roofing-contractor",
    ]));
    expect(landingEntryPoints).toContain("campaign:roof-replacement-cost");
  });

  test.each([
    ["/campaigns/weather-report", "weather-report"],
    ["/campaigns/weather-report/extra", "weather-report"],
    ["/roof-replacement", "roof-replacement"],
    ["/roof-replacement/", "roof-replacement"],
    ["/roofing-contractor", "roofing-contractor"],
    ["/roof-replacement-cost", "roof-replacement-cost"],
    ["/campaigns/roof-replacement", null],
    ["/roof-replacement/extra", null],
    ["/", null],
  ])("%s -> %s", (path, slug) => {
    expect(landingSlugFromPath(path)).toBe(slug);
  });
});
