import { describe, expect, test } from "vitest";
import { parseLeadIntakeFormData } from "./lead-intake-form-data";

function formDataWith(overrides: Record<string, string> = {}) {
  const fields = {
    name: "Jordan Rivera",
    phone: "555-010-1000",
    email: "jordan@example.com",
    addressLine1: "132 Windsor Avenue",
    addressLine2: "",
    city: "Haddonfield",
    state: "NJ",
    postalCode: "08033",
    notes: "",
    ...overrides,
  };
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return formData;
}

describe("parseLeadIntakeFormData", () => {
  test("builds the pipeline address from complete structured fields", () => {
    expect(parseLeadIntakeFormData(formDataWith())).toEqual({
      name: "Jordan Rivera",
      phone: "555-010-1000",
      email: "jordan@example.com",
      submittedAddress: "132 Windsor Avenue, Haddonfield, NJ 08033",
      notes: undefined,
    });
  });

  test("includes an optional unit in the normalized address", () => {
    expect(
      parseLeadIntakeFormData(formDataWith({ addressLine2: "Unit 2" })).submittedAddress,
    ).toBe("132 Windsor Avenue, Unit 2, Haddonfield, NJ 08033");
  });

  test("rejects an incomplete address before creating a lead", () => {
    expect(() => parseLeadIntakeFormData(formDataWith({ city: "", postalCode: "" }))).toThrow();
  });
});
