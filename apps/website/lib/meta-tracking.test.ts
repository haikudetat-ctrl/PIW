import {describe, expect, test} from "vitest";
import {websiteMetaTrackingEnabled} from "./meta-tracking";

describe("website Meta tracking configuration", () => {
  test("fails open for the form flow when tracking configuration is incomplete or malformed", () => {
    expect(websiteMetaTrackingEnabled({
      NEXT_PUBLIC_META_TRACKING_ENABLED: "true",
      NEXT_PUBLIC_META_PIXEL_ID: "not-a-pixel-id",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    })).toBe(false);
    expect(websiteMetaTrackingEnabled({
      NEXT_PUBLIC_META_TRACKING_ENABLED: "true",
      NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
    })).toBe(false);
  });

  test("enables only a complete privacy-aware browser configuration", () => {
    expect(websiteMetaTrackingEnabled({
      NEXT_PUBLIC_META_TRACKING_ENABLED: "true",
      NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    })).toBe(true);
  });
});
