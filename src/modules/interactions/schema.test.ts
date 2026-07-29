import { expect, test } from "vitest";
import { interactionInputSchema } from "./schema";

test("requires a known type and a nonempty summary", () => {
  expect(() => interactionInputSchema.parse({ type: "carrier_pigeon", summary: "x" })).toThrow();
  expect(() => interactionInputSchema.parse({ type: "call", summary: "" })).toThrow();
  expect(interactionInputSchema.parse({ type: "call", summary: "Left a voicemail" })).toEqual({
    type: "call",
    summary: "Left a voicemail",
    occurredAt: undefined,
  });
});
