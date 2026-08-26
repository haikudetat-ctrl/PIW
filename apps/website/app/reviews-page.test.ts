import {readFile} from "node:fs/promises";
import path from "node:path";
import {describe, expect, test} from "vitest";

describe("reviews page claims", () => {
  test("does not describe Google reviews as verified", async () => {
    const html = await readFile(path.join(process.cwd(), "public", "reviews.html"), "utf8");

    expect(html.toLowerCase()).not.toContain("verified google");
    expect(html.toLowerCase()).not.toContain("verified homeowner");
  });
});
