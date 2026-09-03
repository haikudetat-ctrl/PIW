import { describe, expect, test } from "vitest";
import { GET } from "./route";
import {GET as getStaticPage} from "./public-pages/[...path]/route";

describe("canonical All Season homepage", () => {
  test("serves the approved roofing-first homepage", async () => {
    const response = await GET();
    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("All Season Roofing | New Jersey Roof Replacement and Solar");
    expect(html).toContain("The All Season roofing process");
    expect(html).toContain("/services/roofing.html");
    expect(html).toContain("/resources/nj-roof-solar-readiness-checklist.html");
    expect(html).not.toContain("Verified homeowner feedback");
    expect(html).toContain("Reviews are selected and ordered by Google Maps for relevance. Reviews missing required author or source information are omitted.");
    expect(html).toContain('src="/assets/google-maps-attribution/GoogleMaps_Logo_DarkGray.svg"');
    expect(html).toContain('alt="Google Maps"');
    expect(html).toContain('href="/privacy.html"');
    expect(html).toContain('href="/terms.html"');
  });

  test("mounts the consent-gated public runtime exactly once", async () => {
    const response = await GET();
    const html = await response.text();

    expect(html.match(/data-all-season-privacy-runtime="styles"/g)).toHaveLength(1);
    expect(html.match(/data-all-season-privacy-runtime="script"/g)).toHaveLength(1);
    expect(html).toContain('src="/privacy-runtime.js"');
    expect(html).toContain('id="all-season-meta-config"');
  });

  test("mounts the same runtime on a served static subpage", async () => {
    const response = await getStaticPage(new Request("https://allseason.example/privacy.html"), {
      params: Promise.resolve({path: ["privacy.html"]}),
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Privacy Policy");
    expect(html.match(/data-all-season-privacy-runtime="script"/g)).toHaveLength(1);
    expect(html).toContain('src="/privacy-runtime.js"');
  });

  test("does not resolve traversal-shaped static page paths", async () => {
    const response = await getStaticPage(new Request("https://allseason.example/private.html"), {
      params: Promise.resolve({path: ["..", "privacy.html"]}),
    });

    expect(response.status).toBe(404);
  });
});
