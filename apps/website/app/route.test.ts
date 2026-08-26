import { describe, expect, test } from "vitest";
import { GET } from "./route";

describe("canonical All Season homepage", () => {
  test("serves the approved roofing-first homepage", async () => {
    const response = await GET();
    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("All Season Roofing | New Jersey Roof Replacement and Solar");
    expect(html).toContain("The All Season roofing process");
    expect(html).toContain("/services/roofing.html");
    expect(html).toContain("/resources/nj-roof-solar-readiness-checklist.html");
  });
});
