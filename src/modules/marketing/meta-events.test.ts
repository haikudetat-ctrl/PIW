import { describe, expect, test } from "vitest";
import {
  hashMetaValue,
  normalizeMetaEmail,
  normalizeMetaPhone,
  roofPreviewStartedEventId,
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

describe("roofPreviewStartedEventId", () => {
  const previewId = "22222222-2222-4222-8222-222222222222";

  test("is a stable UUID that the Pixel accepts and that does not reveal the preview ID", () => {
    const eventId = roofPreviewStartedEventId(previewId);
    expect(eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(roofPreviewStartedEventId(previewId)).toBe(eventId);
    expect(eventId).not.toContain(previewId.slice(0, 8));
  });

  test("differs between previews", () => {
    expect(roofPreviewStartedEventId(previewId))
      .not.toBe(roofPreviewStartedEventId("33333333-3333-4333-8333-333333333333"));
  });
});
