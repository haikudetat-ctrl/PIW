import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error -- jsdom is supplied by the workspace test runtime.
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";
import { propertyProcessingNotice } from "../lib/property-preview-notice";

const addressEntry = readFileSync(path.join(__dirname, "address-entry.js"), "utf8");
const previewUrl = `https://estimate.allseasonroofingquote.com/roof-estimate/p/${"t".repeat(43)}`;

function page(config: unknown, entryPoint = "main-home") {
  const dom = new JSDOM(`<!doctype html><html><head>
    <script id="all-season-quote-config" type="application/json">${JSON.stringify(config)}</script>
  </head><body><div class="form-card"><form id="leadForm" data-entry-point="${entryPoint}" data-presentation-key="all-season-main">
    <input name="name"><button type="submit">Request my roof plan</button></form></div></body></html>`, {
    url: "https://allseasonroofingquote.com/?utm_source=google&fbclid=abc",
    runScripts: "outside-only",
  });
  const turnstile = {
    render: vi.fn((_el: unknown, options: {callback(token: string): void}) => {
      options.callback("turnstile-token");
      return "widget-1";
    }),
    reset: vi.fn(),
  };
  Object.defineProperty(dom.window, "turnstile", {value: turnstile, configurable: true});
  return dom;
}

const quoteDrawer = readFileSync(path.join(__dirname, "quote-drawer.js"), "utf8");

describe("static address entry", () => {
  test("the quote drawer mounts the same address step", () => {
    const dom = page({previewEnabled: true, turnstileSiteKey: "site"});
    Object.defineProperty(dom.window, "matchMedia", {value: () => ({matches: true})});
    Object.defineProperty(dom.window.crypto, "randomUUID", {value: () => "11111111-1111-4111-8111-111111111111", configurable: true});
    dom.window.eval(addressEntry);
    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const panel = dom.window.document.querySelector(".as-quote-panel")!;
    expect(panel.querySelector(".as-quote-form")).toBeNull();
    const step = panel.querySelector("[data-preview-address-form]");
    expect(step).not.toBeNull();
    expect(step?.querySelector("[data-preview-notice]")?.textContent).toBe(propertyProcessingNotice());
  });


  test("leaves the legacy form alone when the preview flow is off", () => {
    const dom = page({previewEnabled: false, turnstileSiteKey: null});
    dom.window.eval(addressEntry);
    expect(dom.window.document.querySelector("#leadForm")).not.toBeNull();
    expect(dom.window.document.querySelector("[data-preview-address-form]")).toBeNull();
  });

  test("replaces the long form with the address step and its notice", () => {
    const dom = page({previewEnabled: true, turnstileSiteKey: "site"});
    dom.window.eval(addressEntry);
    const document = dom.window.document;
    expect(document.querySelector("#leadForm")).toBeNull();
    const form = document.querySelector("[data-preview-address-form]")!;
    expect(form.querySelector("[data-preview-notice]")?.textContent).toBe(propertyProcessingNotice());
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe("See my roof");
    expect(form.querySelectorAll('input[name="name"], input[type="email"], input[type="tel"], input[type="checkbox"]')).toHaveLength(0);
  });

  test("creates a preview from a manual address and continues to it", async () => {
    const dom = page({previewEnabled: true, turnstileSiteKey: "site"}, "main-contact");
    const fetch = vi.fn(async (url: string) => String(url).includes("/api/property-preview")
      ? Response.json({previewUrl}, {status: 201})
      : Response.json({suggestions: []}));
    dom.window.fetch = fetch as typeof dom.window.fetch;
    dom.window.eval(addressEntry);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    const document = dom.window.document;
    (document.querySelector("[data-manual-toggle]") as HTMLButtonElement).click();
    const set = (name: string, value: string) => { (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value; };
    set("address_line_1", "12 Birch Street");
    set("city", "Trenton");
    set("postal_code", "08608");
    document.querySelector("[data-preview-address-form]")!.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/property-preview"))).toBe(true));
    // A successful preview navigates away; the form stays pending with no error.
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    expect(document.querySelector('[role="alert"]')?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector('[data-preview-address-form] button[type="submit"]')?.textContent).toBe("Finding your roof…");
    const call = fetch.mock.calls.find(([url]) => String(url).includes("/api/property-preview")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({
      address: "12 Birch Street, Trenton, NJ 08608",
      google_place_id: null,
      campaign: null,
      entry_point: "main-contact",
      presentation_key: "all-season-main",
      turnstile_token: "turnstile-token",
      utm_source: "google",
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      fbclid: "abc",
    });
  });

  test("uses a selected suggestion's Place ID", async () => {
    const dom = page({previewEnabled: true, turnstileSiteKey: "site"});
    const fetch = vi.fn(async (url: string) => String(url).includes("/api/address-autocomplete")
      ? Response.json({suggestions: [{placeId: "ChIJ-one", address: "1 Main St, Newark, NJ 07102, USA"}]})
      : Response.json({previewUrl}, {status: 201}));
    dom.window.fetch = fetch as typeof dom.window.fetch;
    dom.window.eval(addressEntry);
    const document = dom.window.document;
    const search = document.querySelector("[data-address-search]") as HTMLInputElement;
    search.value = "1 Main";
    search.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
    await vi.waitFor(() => expect(document.querySelector("[data-suggestion]")).not.toBeNull(), {timeout: 2000});
    (document.querySelector("[data-suggestion]") as HTMLButtonElement).click();
    document.querySelector("[data-preview-address-form]")!.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/property-preview"))).toBe(true));
    const call = fetch.mock.calls.find(([url]) => String(url).includes("/api/property-preview")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({address: "1 Main St, Newark, NJ 07102, USA", google_place_id: "ChIJ-one"});
  });

  test("asks for an address before submitting", () => {
    const dom = page({previewEnabled: true, turnstileSiteKey: "site"});
    const fetch = vi.fn();
    dom.window.fetch = fetch as typeof dom.window.fetch;
    dom.window.eval(addressEntry);
    dom.window.document.querySelector("[data-preview-address-form]")!.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toMatch(/address/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
