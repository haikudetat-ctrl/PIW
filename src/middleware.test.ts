import {describe, expect, test} from "vitest";
import {isPublicPath} from "./middleware";

describe("public assessment media boundary", () => {
  test.each([
    "/campaigns/for-every-season/hero.webp",
    "/campaigns/weather-report/hero.webp",
    "/campaigns/seasonal-shield/hero.webp",
  ])("allows anonymous access to %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  test.each([
    "/pipeline",
    "/campaign-admin",
    "/campaigns-private/roof.webp",
    "/campaigns/unapproved/hero.webp",
  ])("does not broaden anonymous access to %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});
