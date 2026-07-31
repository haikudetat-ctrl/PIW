import { describe, expect, test } from "vitest";
import {
  formatSubmittedAddress,
  parsePublicRoofEstimateFormData,
} from "./form-data";

function validFormData() {
  const data = new FormData();
  Object.entries({
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
});
