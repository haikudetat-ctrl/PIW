import { expect, test } from "vitest";
import { normalizeAddressForMatching } from "./normalize-address";

test("collapses whitespace, case, and punctuation for stable matching", () => {
  expect(normalizeAddressForMatching("  12 Birch St., Trenton, NJ  ")).toBe(
    normalizeAddressForMatching("12 BIRCH ST TRENTON NJ"),
  );
});
