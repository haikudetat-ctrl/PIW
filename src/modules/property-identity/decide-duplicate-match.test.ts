import { expect, test } from "vitest";
import { decideDuplicateMatch } from "./decide-duplicate-match";

test("no candidates is no_match", () => {
  expect(decideDuplicateMatch([])).toEqual({ outcome: "no_match" });
});

test("exactly one candidate merges into it", () => {
  expect(
    decideDuplicateMatch([{ propertyId: "11111111-1111-4111-8111-111111111111" }]),
  ).toEqual({
    outcome: "merge",
    canonicalPropertyId: "11111111-1111-4111-8111-111111111111",
  });
});

test("more than one candidate is ambiguous", () => {
  expect(
    decideDuplicateMatch([
      { propertyId: "11111111-1111-4111-8111-111111111111" },
      { propertyId: "22222222-2222-4222-8222-222222222222" },
    ]),
  ).toEqual({
    outcome: "ambiguous",
    candidatePropertyIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  });
});
