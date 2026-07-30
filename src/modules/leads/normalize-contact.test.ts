import { expect, test } from "vitest";
import { normalizeEmailForMatching, normalizePhoneToE164 } from "./normalize-contact";

test("strips formatting to a bare 10-digit US number", () => {
  expect(normalizePhoneToE164("(555) 010-1000")).toBe("+15550101000");
});

test("drops a leading US country code", () => {
  expect(normalizePhoneToE164("1-555-010-1000")).toBe("+15550101000");
});

test("returns null for a number that isn't a 10-digit US number", () => {
  expect(normalizePhoneToE164("555-0100")).toBeNull();
});

test("trims and lowercases email for stable matching", () => {
  expect(normalizeEmailForMatching("  Jordan.Rivera@Example.com  ")).toBe(
    "jordan.rivera@example.com",
  );
});
