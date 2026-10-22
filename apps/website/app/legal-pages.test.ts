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

  test("explains the consent-gated Meta measurement boundary in plain language", async () => {
    const html = await publicPage("privacy.html");

    expect(html).toContain("Meta Pixel and Conversions API");
    expect(html).toContain("PageView");
    expect(html).toContain("Lead");
    expect(html).toContain("QualifiedLead");
    expect(html).toContain("AssessmentCompleted");
    expect(html).toContain("hashed email address, but not your phone number");
    expect(html).toContain("We do not send your phone number, text-messaging opt-in data, consent records");
    expect(html).toContain("Mobile information will not be shared with third parties or affiliates for their marketing or promotional purposes.");
    expect(html).toContain("Text messaging originator opt-in data and consent will not be shared with any third parties.");
    expect(html).toContain("withdraw or change your advertising choice");
    expect(html).toContain("(856) 835-6022");
  });
});
