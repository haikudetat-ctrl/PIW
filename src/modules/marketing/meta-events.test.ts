import { describe, expect, test } from "vitest";
import {
  hashMetaValue,
  normalizeMetaEmail,
  normalizeMetaPhone,
} from "./meta-events";

describe("Meta identifier normalization", () => {
  test("normalizes and hashes matching fields", () => {
    expect(normalizeMetaEmail(" Chris@Example.COM ")).toBe("chris@example.com");
    expect(normalizeMetaPhone("(732) 555-0124", "US")).toBe("17325550124");
    expect(hashMetaValue("chris@example.com")).toBe(
      "b4b5b0add35b4959f546b421b30cee70dad83efbce876d4a4d927f9a085efc78",
    );
  });

  test.each([
    "555-0124",
    "732-555-0124 ext 5",
    "+44 20 7946 0958",
    "1-732-555-012",
    "11-732-555-0124",
  ])("rejects ambiguous or invalid US phone input %s", (phone) => {
    expect(() => normalizeMetaPhone(phone, "US")).toThrow(/US phone/i);
  });

  test("rejects unsupported phone countries rather than guessing", () => {
    expect(() => normalizeMetaPhone("020 7946 0958", "GB" as "US")).toThrow(
      /country/i,
    );
  });
});
