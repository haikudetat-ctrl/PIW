import { readFileSync } from "node:fs";
import path from "node:path";
// jsdom is supplied by the workspace test runtime but does not bundle types.
// @ts-expect-error -- this test executes the real browser scripts in jsdom.
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";

const script = readFileSync(path.join(__dirname, "script.js"), "utf8");
const quoteDrawer = readFileSync(path.join(__dirname, "quote-drawer.js"), "utf8");
const homepage = readFileSync(path.join(__dirname, "index.html"), "utf8");
const contactPage = readFileSync(path.join(__dirname, "contact.html"), "utf8");

const estimateUrl = "https://piw.example/roof-estimate/continue/safe_token";

function leadFormMarkup(entryPoint = "main-home") {
  return `<form id="leadForm" data-entry-point="${entryPoint}" data-presentation-key="all-season-main">
    <input name="name" value="Alex Rivera" required>
    <input name="phone" value="201-555-0100" required>
    <input name="email" type="email" value="alex@example.com" required>
    <input name="address_line_1" value="1 Main St" required>
    <input name="address_line_2" value="Unit 2">
    <input name="city" value="Newark" required>
    <input name="state" value="NJ" required>
    <input name="postal_code" value="07102" required>
    <input name="consent_to_contact" type="checkbox" checked required>
    <input name="consent_to_process_property" type="checkbox" checked required>
    <button type="submit">Request</button>
  </form><div id="successMsg"></div>`;
}

function installBrowserGlobals(dom: { window: { crypto: Crypto } }) {
  Object.defineProperty(dom.window.crypto, "randomUUID", {
    value: () => "11111111-1111-4111-8111-111111111111",
    configurable: true,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: true }),
  });
}

describe("embedded lead form", () => {
  test("posts the campaign estimate contract and captures paid attribution", async () => {
    const dom = new JSDOM(`<!doctype html><body>${leadFormMarkup()}</body>`, {
      url: "https://allseason.example/?utm_source=google&utm_medium=cpc&utm_campaign=roof-search&utm_term=roofing&utm_content=hero&fbclid=click-123",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({accepted: true, estimateUrl}, { status: 202 }),
    );
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(script);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    dom.window.document.querySelector("form")?.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    const request = fetch.mock.calls[0];
    expect(request?.[0]).toBe("/api/campaign-estimate");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      submission_id: "11111111-1111-4111-8111-111111111111",
      campaign: null,
      presentation_key: "all-season-main",
      entry_point: "main-home",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Unit 2, Newark, NJ 07102",
      google_place_id: null,
      address_line_1: "1 Main St",
      address_line_2: "Unit 2",
      city: "Newark",
      state: "NJ",
      postal_code: "07102",
      consent_to_contact: true,
      consent_to_process_property: true,
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "roof-search",
      utm_term: "roofing",
      utm_content: "hero",
      fbclid: "click-123",
    });
  });

  test("emits the exact PIW-issued Meta envelope before continuing to the estimate", async () => {
    const dom = new JSDOM(`<!doctype html><body>${leadFormMarkup()}</body>`, {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const metaEvent = {
      name: "QualifiedLead",
      eventId: "33333333-3333-4333-8333-333333333333",
      issuedAt: "2026-09-01T16:01:00.000Z",
    } as const;
    const trackConversionBeforeNavigation = vi.fn(async () => {});
    Object.defineProperty(dom.window, "AllSeasonMeta", {
      value: {trackConversionBeforeNavigation},
      configurable: true,
    });
    dom.window.fetch = vi.fn(async () => Response.json({
      accepted: true,
      estimateUrl,
      metaEvent,
    }, {status: 202})) as typeof dom.window.fetch;

    dom.window.eval(script);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    dom.window.document.querySelector("form")?.dispatchEvent(
      new dom.window.Event("submit", {bubbles: true, cancelable: true}),
    );

    await vi.waitFor(() => expect(trackConversionBeforeNavigation).toHaveBeenCalledWith(metaEvent));
  });

  test("rejects a malformed successful estimate envelope instead of inventing a Meta event", async () => {
    const dom = new JSDOM(`<!doctype html><body>${leadFormMarkup()}</body>`, {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const trackConversionBeforeNavigation = vi.fn(async () => {});
    Object.defineProperty(dom.window, "AllSeasonMeta", {
      value: {trackConversionBeforeNavigation},
      configurable: true,
    });
    dom.window.fetch = vi.fn(async () => Response.json({
      accepted: true,
      estimateUrl,
      metaEvent: {
        name: "QualifiedLead",
        eventId: "not-a-uuid",
        issuedAt: "2026-09-01T16:01:00.000Z",
      },
    }, {status: 202})) as typeof dom.window.fetch;

    dom.window.eval(script);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    dom.window.document.querySelector("form")?.dispatchEvent(
      new dom.window.Event("submit", {bubbles: true, cancelable: true}),
    );

    await vi.waitFor(() => expect(dom.window.document.querySelector('[data-submit-error]'))
      .not.toBeNull());
    expect(trackConversionBeforeNavigation).not.toHaveBeenCalled();
  });

  test.each([
    ["homepage", homepage, "main-home", "all-season-main"],
    ["contact", contactPage, "main-contact", "all-season-main"],
  ])("renders canonical source metadata and campaign-compatible fields on the %s", (_label, html, entryPoint, presentationKey) => {
    const dom = new JSDOM(html);
    const form = dom.window.document.querySelector("#leadForm");
    const namedFields = Array.from(form?.querySelectorAll("[name]") ?? []) as HTMLElement[];
    const names = namedFields.map((field) => field.getAttribute("name"));

    expect(form?.getAttribute("data-entry-point")).toBe(entryPoint);
    expect(form?.getAttribute("data-presentation-key")).toBe(presentationKey);

    expect(names).toEqual([
      "name",
      "phone",
      "email",
      "address_line_1",
      "address_line_2",
      "city",
      "postal_code",
      "state",
      "consent_to_process_property",
      "consent_to_contact",
    ]);
  });

  test.each([
    ["homepage", "main-home", "all-season-main"],
    ["contact", "main-contact", "all-season-main"],
  ])("submits the exact %s source mapping", async (_label, entryPoint, presentationKey) => {
    const dom=new JSDOM(`<!doctype html><body>${leadFormMarkup(entryPoint)}</body>`,{url:"https://allseason.example/",runScripts:"outside-only"});
    installBrowserGlobals(dom);
    const fetch=vi.fn<(input:string,init?:RequestInit)=>Promise<Response>>(async()=>new Response(null,{status:502}));
    dom.window.fetch=fetch as typeof dom.window.fetch;
    dom.window.eval(script);
    await new Promise((resolve)=>dom.window.setTimeout(resolve,0));
    dom.window.document.querySelector("form")?.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(expect.objectContaining({campaign:null,entry_point:entryPoint,presentation_key:presentationKey}));
  });

  test("reuses the submission ID when a failed request is retried", async () => {
    const dom = new JSDOM(`<!doctype html><body>${leadFormMarkup()}</body>`, {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    let uuidCalls = 0;
    Object.defineProperty(dom.window.crypto, "randomUUID", {
      value: () => `${++uuidCalls}1111111-1111-4111-8111-111111111111`,
      configurable: true,
    });
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(script);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    const form = dom.window.document.querySelector("form");
    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const first = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(second.submission_id).toBe(first.submission_id);
  });
});

describe("quote drawer", () => {
  test("requires property-processing consent", () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

    expect(
      dom.window.document.querySelector('input[name="consent_to_process_property"]'),
    ).not.toBeNull();
  });

  test("shows ZIP field validation and never submits an invalid ZIP", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const form = dom.window.document.querySelector<HTMLFormElement>(".as-quote-form")!;
    const values = {
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address_line_1: "1 Main St",
      city: "Newark",
      postal_code: "abc",
    };
    for (const [name, value] of Object.entries(values)) {
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
    }
    form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input: HTMLInputElement) => {
      input.checked = true;
    });

    form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(fetch).not.toHaveBeenCalled();
    expect(form.querySelector("#as-quote-postal_code-error")?.textContent).toBe("Enter a valid ZIP code.");
    expect(form.querySelector('[name="postal_code"]')?.getAttribute("aria-invalid")).toBe("true");
  });

  test("reuses its submission ID when delivery is retried", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    let uuidCalls = 0;
    Object.defineProperty(dom.window.crypto, "randomUUID", {
      value: () => `${++uuidCalls}1111111-1111-4111-8111-111111111111`,
      configurable: true,
    });
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const form = dom.window.document.querySelector<HTMLFormElement>(".as-quote-form");
    const values = {
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address_line_1: "1 Main St",
      city: "Newark",
      postal_code: "07102",
    };
    for (const [name, value] of Object.entries(values)) {
      const input = form?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (input) input.value = value;
    }
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input: HTMLInputElement) => {
      input.checked = true;
    });

    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const first = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(second.submission_id).toBe(first.submission_id);
  });

  test("uses the same campaign estimate request as the embedded forms", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://allseason.example/?utm_source=facebook&utm_medium=paid-social&fbclid=click-123",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({accepted: true, estimateUrl}, {status: 202}),
    );
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const form = dom.window.document.querySelector<HTMLFormElement>(".as-quote-form")!;
    const values = {
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address_line_1: "1 Main St",
      address_line_2: "Unit 2",
      city: "Newark",
      postal_code: "07102",
    };
    for (const [name, value] of Object.entries(values)) {
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
    }
    form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input: HTMLInputElement) => {
      input.checked = true;
    });

    form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    expect(fetch.mock.calls[0]?.[0]).toBe("/api/campaign-estimate");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(expect.objectContaining({
      campaign: null,
      entry_point: "main-drawer",
      presentation_key: "all-season-main",
      address: "1 Main St, Unit 2, Newark, NJ 07102",
      google_place_id: null,
      address_line_1: "1 Main St",
      address_line_2: "Unit 2",
      city: "Newark",
      state: "NJ",
      postal_code: "07102",
      utm_source: "facebook",
      utm_medium: "paid-social",
      fbclid: "click-123",
    }));
  });

  test("emits the exact PIW-issued Meta envelope before moving to the estimate", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const metaEvent = {
      name: "QualifiedLead",
      eventId: "55555555-5555-4555-8555-555555555555",
      issuedAt: "2026-09-01T16:01:00.000Z",
    } as const;
    const trackConversionBeforeNavigation = vi.fn(async () => {});
    Object.defineProperties(dom.window, {
      AllSeasonCanonicalEstimate: {
        value: {parse: (payload: unknown) => payload},
        configurable: true,
      },
      AllSeasonMeta: {
        value: {trackConversionBeforeNavigation},
        configurable: true,
      },
    });
    dom.window.fetch = vi.fn(async () => Response.json({
      accepted: true,
      estimateUrl,
      metaEvent,
    }, {status: 202})) as typeof dom.window.fetch;

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const form = dom.window.document.querySelector<HTMLFormElement>(".as-quote-form")!;
    const values = {
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address_line_1: "1 Main St",
      city: "Newark",
      postal_code: "07102",
    };
    for (const [name, value] of Object.entries(values)) {
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
    }
    (Array.from(form.querySelectorAll('input[type="checkbox"]')) as unknown as HTMLInputElement[]).forEach((input) => {
      input.checked = true;
    });

    form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));

    await vi.waitFor(() => expect(trackConversionBeforeNavigation).toHaveBeenCalledWith(metaEvent));
  });
});
