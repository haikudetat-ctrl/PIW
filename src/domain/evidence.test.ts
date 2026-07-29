import { expect, test } from "vitest";
import { confidenceSchema, observationMethodSchema } from "./evidence";

test("confidence is an integer from zero through one hundred", () => {
  expect(confidenceSchema.parse(95)).toBe(95);
  expect(() => confidenceSchema.parse(100.1)).toThrow();
  expect(() => confidenceSchema.parse(-1)).toThrow();
});

test("observation method is explicit", () => {
  expect(observationMethodSchema.options).toEqual([
    "measured",
    "calculated",
    "assumed",
    "reported",
  ]);
});
