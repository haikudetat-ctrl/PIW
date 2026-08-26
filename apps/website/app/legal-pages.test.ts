import {readFile} from "node:fs/promises";
import path from "node:path";
import {describe, expect, test} from "vitest";

async function publicPage(fileName: string) {
  return readFile(path.join(process.cwd(), "public", fileName), "utf8");
}

describe("public legal pages", () => {
  test.each([
    ["privacy.html", "Privacy Policy"],
    ["terms.html", "Terms of Use"],
  ])("publishes %s with Google Maps flow-down links", async (fileName, title) => {
    const html = await publicPage(fileName);

    expect(html).toContain(`<h1>${title}</h1>`);
    expect(html).toContain('href="https://maps.google.com/help/terms_maps/"');
    expect(html).toContain('href="https://policies.google.com/privacy"');
    expect(html).toContain('href="/index.html"');
  });
});
