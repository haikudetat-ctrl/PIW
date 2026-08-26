import { describe, expect, test } from "vitest";
import {
  formatSubmittedAddress,
  parsePublicRoofEstimateFormData,
  readRoofEstimateAttribution,
  resolveRoofEstimateEntryContext,
} from "./form-data";

function validFormData() {
  const data = new FormData();
  Object.entries({
    campaign: "for-every-season",
    name: "Jordan Homeowner",
    phone: "609-555-0100",
    email: "jordan@example.com",
    addressMode: "manual",
    addressLine1: "12 Birch Street",
    addressLine2: "",
    city: "Trenton",
    state: "NJ",
    postalCode: "08608",
    consentEstimate: "on",
    consentEmail: "on",
    consentSms: "on",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("public roof estimate form", () => {
  test("requires all three consent gates", () => {
    const data = validFormData();
    data.delete("consentSms");
    expect(() => parsePublicRoofEstimateFormData(data)).toThrow();
  });

  test("builds a structured address for Google", () => {
    expect(formatSubmittedAddress(parsePublicRoofEstimateFormData(validFormData()))).toBe(
      "12 Birch Street, Trenton, NJ, 08608",
    );
  });

  test("uses the selected Google address and retains its Place ID", () => {
    const data = validFormData();
    data.set("addressMode", "google");
    data.set("googlePlaceId", "ChIJ-selected");
    data.set("selectedAddress", "132 Windsor Ave, Haddon Township, NJ 08108, USA");
    const parsed = parsePublicRoofEstimateFormData(data);
    expect(parsed.googlePlaceId).toBe("ChIJ-selected");
    expect(formatSubmittedAddress(parsed)).toBe("132 Windsor Ave, Haddon Township, NJ 08108, USA");
  });

  test("only accepts configured campaign attribution", () => {
    const data = validFormData();
    data.set("campaign", "made-up-campaign");
    expect(() => parsePublicRoofEstimateFormData(data)).toThrow();
  });

  test("maps an exact campaign referrer to its matching presentation literals", () => {
    expect(resolveRoofEstimateEntryContext(
      "https://piw.example/campaigns/weather-report?utm_source=facebook",
      "weather-report",
    )).toEqual({
      campaign: "weather-report",
      presentationKey: "weather-report",
      entryPoint: "campaign:weather-report",
    });
  });

  test.each([
    "https://piw.example/roof-estimate",
    "https://piw.example/campaigns/seasonal-shield",
    "not a URL",
    null,
  ])("fails closed to the main roof-estimate context for a nonmatching referrer", (referrer) => {
    expect(resolveRoofEstimateEntryContext(referrer, "weather-report")).toEqual({
      campaign: null,
      presentationKey: "all-season-main",
      entryPoint: "roof-estimate",
    });
  });

  test("preserves UTM and click attribution from the submitting page referrer", () => {
    expect(readRoofEstimateAttribution(
      "https://piw.example/campaigns/weather-report?utm_source=facebook&utm_medium=paid-social&utm_campaign=storm&utm_term=roof&utm_content=hero&fbclid=click-123",
    )).toEqual({
      utm_source: "facebook",
      utm_medium: "paid-social",
      utm_campaign: "storm",
      utm_term: "roof",
      utm_content: "hero",
      fbclid: "click-123",
      fbp: null,
      fbc: null,
    });
  });
});
