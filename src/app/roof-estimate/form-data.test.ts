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
});
