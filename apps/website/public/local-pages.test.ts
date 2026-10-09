import {readFileSync, readdirSync} from "node:fs";
import path from "node:path";
// @ts-expect-error -- jsdom is supplied by the workspace test runtime.
import {JSDOM} from "jsdom";
import {describe, expect, test, vi} from "vitest";

type LocalAreas = {
  counties: Array<{name: string; slug: string}>;
  towns: Array<{name: string; slug: string; county: string; places: string[]; nearby: string[]}>;
};

const local = JSON.parse(readFileSync(path.join(__dirname, "..", "data", "local-areas.json"), "utf8")) as LocalAreas;
const script = readFileSync(path.join(__dirname, "script.js"), "utf8");
const addressEntry = readFileSync(path.join(__dirname, "address-entry.js"), "utf8");
const focusSlugs = [...local.counties.map((county) => county.slug), ...local.towns.map((town) => town.slug)];

function generated(slug: string) {
  return readFileSync(path.join(__dirname, "service-areas", `${slug}.html`), "utf8");
}

function publicFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return publicFiles(full);
    return /\.(html|txt|xml)$/.test(entry.name) ? [full] : [];
  });
}

describe("South Jersey location pages", () => {
  test.each(focusSlugs)("%s is a For Every Season landing page on the brand domain", (slug) => {
    const html = generated(slug);
    const {document} = new JSDOM(html).window;

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href"))
      .toBe(`https://allseasonroofingquote.com/service-areas/${slug}.html`);
    const form = document.querySelector("#leadForm");
    expect(form?.getAttribute("data-entry-point")).toBe("campaign:for-every-season");
    expect(form?.getAttribute("data-presentation-key")).toBe("for-every-season");
    expect(form?.getAttribute("data-campaign")).toBe("for-every-season");
    const submitLabel = form?.querySelector('button[type="submit"]')?.textContent;
    expect(form?.querySelector(".consent")?.textContent).toContain(`“${submitLabel},”`);
    expect(document.querySelector("[data-google-reviews]")?.getAttribute("data-review-match")).toBeTruthy();
    expect(() => JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!)).not.toThrow();
  });

  test("every town page links to its county and to existing nearby towns", () => {
    for (const town of local.towns) {
      const {document} = new JSDOM(generated(town.slug)).window;
      const links = Array.from(document.querySelectorAll("a[href]")).map((link) => (link as Element).getAttribute("href"));
      expect(links).toContain(`/service-areas/${town.county}.html`);
      for (const nearby of town.nearby) {
        expect(focusSlugs).toContain(nearby);
        expect(links).toContain(`/service-areas/${nearby}.html`);
      }
    }
  });

  test("the sitemap lists every location page and nothing points at the old domain", () => {
    const sitemap = readFileSync(path.join(__dirname, "sitemap.xml"), "utf8");
    for (const slug of focusSlugs) {
      expect(sitemap).toContain(`<loc>https://allseasonroofingquote.com/service-areas/${slug}.html</loc>`);
    }
    const stale = publicFiles(__dirname).filter((file) => readFileSync(file, "utf8").includes("allseasonsolar.net"));
    expect(stale).toEqual([]);
  });
});

describe("campaign credit from location pages", () => {
  test("the embedded form credits For Every Season", async () => {
    const dom = new JSDOM(`<!doctype html><body><form id="leadForm" data-entry-point="campaign:for-every-season" data-presentation-key="for-every-season" data-campaign="for-every-season">
      <input name="name" value="Alex Rivera"><input name="phone" value="609-555-0100"><input name="email" type="email" value="alex@example.com">
      <input name="address_line_1" value="1 Main St"><input name="city" value="Galloway"><input name="state" value="NJ"><input name="postal_code" value="08205">
      <button type="submit">Get my roof estimate</button></form></body>`, {
      url: "https://allseasonroofingquote.com/service-areas/galloway-nj.html?utm_source=meta&utm_content=galloway",
      runScripts: "outside-only",
    });
    Object.defineProperty(dom.window.crypto, "randomUUID", {value: () => "11111111-1111-4111-8111-111111111111", configurable: true});
    Object.defineProperty(dom.window, "matchMedia", {value: () => ({matches: true})});
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({}, {status: 500}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(script);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    dom.window.document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      campaign: "for-every-season",
      presentation_key: "for-every-season",
      entry_point: "campaign:for-every-season",
      utm_content: "galloway",
    });
  });

  test("the address-first preview step credits For Every Season", async () => {
    const dom = new JSDOM(`<!doctype html><html><head>
      <script id="all-season-quote-config" type="application/json">{"previewEnabled":true,"turnstileSiteKey":"site"}</script>
    </head><body><div class="form-card"><form id="leadForm" data-entry-point="campaign:for-every-season" data-presentation-key="for-every-season" data-campaign="for-every-season">
      <button type="submit">Get my roof estimate</button></form></div></body></html>`, {
      url: "https://allseasonroofingquote.com/service-areas/galloway-nj.html",
      runScripts: "outside-only",
    });
    Object.defineProperty(dom.window, "turnstile", {
      value: {render: (_el: unknown, options: {callback(token: string): void}) => { options.callback("turnstile-token"); return "widget-1"; }, reset: vi.fn()},
      configurable: true,
    });
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({suggestions: []}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(addressEntry);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    const document = dom.window.document;
    (document.querySelector("[data-manual-toggle]") as HTMLButtonElement).click();
    const set = (name: string, value: string) => { (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value; };
    set("address_line_1", "12 Birch Street");
    set("city", "Galloway");
    set("postal_code", "08205");
    document.querySelector("[data-preview-address-form]")!.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/property-preview"))).toBe(true));

    const call = fetch.mock.calls.find(([url]) => String(url).includes("/api/property-preview")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({
      campaign: "for-every-season",
      entry_point: "campaign:for-every-season",
      presentation_key: "for-every-season",
    });
  });
});

describe("local review ordering", () => {
  test("reviews that mention the town are shown first", async () => {
    const review = (author: string, text: string) => ({
      author,
      authorUri: `https://www.google.com/maps/contrib/${author}`,
      rating: 5,
      text,
      relativeTime: "a month ago",
      reviewUri: `https://www.google.com/maps/reviews/${author}`,
    });
    const dom = new JSDOM(`<!doctype html><body><section data-google-reviews data-review-match="Galloway|Smithville">
      <a data-google-reviews-link href="https://www.google.com/maps"></a><span data-google-rating></span>
      <div data-google-reviews-viewport hidden><div data-google-reviews-track></div></div>
      <div data-google-attributions></div><p data-google-reviews-fallback></p></section></body>`, {
      runScripts: "outside-only",
      url: "https://allseasonroofingquote.com/service-areas/galloway-nj.html",
    });
    Object.defineProperty(dom.window, "matchMedia", {configurable: true, value: () => ({matches: true})});
    Object.defineProperty(dom.window, "fetch", {
      configurable: true,
      value: vi.fn(async () => Response.json({
        rating: 4.9,
        reviewCount: 3,
        googleMapsUri: "https://www.google.com/maps/place/all-season",
        attributions: [],
        reviews: [
          review("first", "Great crew in Cherry Hill."),
          review("second", "They replaced our roof in Smithville in two days."),
          review("third", "Clean job and fair price."),
        ],
      })),
    });

    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelectorAll(".google-review-card:not([aria-hidden])").length).toBeGreaterThanOrEqual(3));

    const authors = Array.from(dom.window.document.querySelectorAll<HTMLElement>(".google-review-card:not([aria-hidden]) strong"))
      .map((node) => (node as Element).textContent);
    expect(authors.slice(0, 3)).toEqual(["second", "first", "third"]);
  });
});
