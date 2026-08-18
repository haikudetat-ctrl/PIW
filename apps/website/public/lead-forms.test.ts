import { readFileSync } from "node:fs";
import path from "node:path";
// jsdom is supplied by the workspace test runtime but does not bundle types.
// @ts-expect-error -- this test executes the real browser scripts in jsdom.
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";

const script = readFileSync(path.join(__dirname, "script.js"), "utf8");
const quoteDrawer = readFileSync(path.join(__dirname, "quote-drawer.js"), "utf8");

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
  test("posts a consented lead to the same-origin intake route", async () => {
    const dom = new JSDOM(`<!doctype html><body>
      <form id="leadForm">
        <input name="first_name" value="Alex" required>
        <input name="last_name" value="Rivera" required>
        <input name="phone" value="201-555-0100" required>
        <input name="email" type="email" value="alex@example.com" required>
        <input name="address_line1" value="1 Main St" required>
        <input name="city" value="Newark" required>
        <input name="state" value="NJ" required>
        <input name="zip" value="07102" required>
        <select name="project_interest" required><option value="solar" selected>Solar</option></select>
        <input name="consent_to_contact" type="checkbox" checked required>
        <input name="consent_to_process_property" type="checkbox" checked required>
        <button type="submit">Request</button>
      </form>
      <div id="successMsg"></div>
    </body>`, { url: "https://allseason.example/?fbclid=click-123", runScripts: "outside-only" });
    installBrowserGlobals(dom);
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 202 }),
    );
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(script);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    dom.window.document.querySelector("form")?.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    const request = fetch.mock.calls[0];
    expect(request?.[0]).toBe("/api/intake");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual(expect.objectContaining({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      address: "1 Main St, Newark, NJ 07102",
      project_interest: "solar",
      consent_to_contact: true,
      consent_to_process_property: true,
      fbclid: "click-123",
    }));
  });

  test("reuses the submission ID when a failed request is retried", async () => {
    const dom = new JSDOM(`<!doctype html><body>
      <form id="leadForm">
        <input name="first_name" value="Alex" required><input name="last_name" value="Rivera" required>
        <input name="phone" value="201-555-0100" required><input name="email" type="email" value="alex@example.com" required>
        <input name="address_line1" value="1 Main St" required><input name="city" value="Newark" required>
        <input name="state" value="NJ" required><input name="zip" value="07102" required>
        <select name="project_interest" required><option value="solar" selected>Solar</option></select>
        <input name="consent_to_contact" type="checkbox" checked required>
        <input name="consent_to_process_property" type="checkbox" checked required>
        <button type="submit">Request</button>
      </form><div id="successMsg"></div>
    </body>`, { url: "https://allseason.example/", runScripts: "outside-only" });
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
    let intakeCalls = 0;
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (String(input).startsWith("/api/address-suggestions")) {
        return Response.json({ suggestions: [{
          placeId: "ChIJ-selected",
          address: "354 Stockton St, Princeton, NJ 08540, USA",
        }] });
      }
      intakeCalls += 1;
      return new Response(null, { status: intakeCalls === 1 ? 502 : 202 });
    });
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const form = dom.window.document.querySelector<HTMLFormElement>(".as-quote-form");
    const values = {
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
    };
    for (const [name, value] of Object.entries(values)) {
      const input = form?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (input) input.value = value;
    }
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input: HTMLInputElement) => {
      input.checked = true;
    });

    const address = form?.querySelector<HTMLInputElement>('[name="address"]');
    address?.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(
      dom.window.document.querySelectorAll(".as-quote-address-option"),
    ).toHaveLength(1));
    dom.window.document.querySelector<HTMLButtonElement>(".as-quote-address-option")?.click();

    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(intakeCalls).toBe(1));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(intakeCalls).toBe(2));

    const intakeRequests = fetch.mock.calls.filter(([input]) => input === "/api/intake");
    const first = JSON.parse(String(intakeRequests[0]?.[1]?.body));
    const second = JSON.parse(String(intakeRequests[1]?.[1]?.body));
    expect(second.submission_id).toBe(first.submission_id);
  });

  test("requires a selected normalized address and submits its Google Place ID", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://allseason.example/",
      runScripts: "outside-only",
    });
    installBrowserGlobals(dom);
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (String(input).startsWith("/api/address-suggestions")) {
        return Response.json({ suggestions: [{
          placeId: "ChIJ-selected",
          address: "354 Stockton St, Princeton, NJ 08540, USA",
        }] });
      }
      return new Response(null, { status: 202 });
    });
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(quoteDrawer);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const form = dom.window.document.querySelector<HTMLFormElement>(".as-quote-form");
    for (const [name, value] of Object.entries({
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "354 Stock",
    })) {
      const input = form?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (input) input.value = value;
    }
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input: HTMLInputElement) => {
      input.checked = true;
    });

    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    expect(fetch).not.toHaveBeenCalled();
    expect(form?.querySelector<HTMLInputElement>('[name="address"]')?.getAttribute("aria-invalid"))
      .toBe("true");

    const address = form?.querySelector<HTMLInputElement>('[name="address"]');
    address?.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(
      dom.window.document.querySelectorAll(".as-quote-address-option"),
    ).toHaveLength(1));
    dom.window.document.querySelector<HTMLButtonElement>(".as-quote-address-option")?.click();
    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(
      fetch.mock.calls.filter(([input]) => input === "/api/intake"),
    ).toHaveLength(1));
    const intake = fetch.mock.calls.find(([input]) => input === "/api/intake");
    expect(JSON.parse(String(intake?.[1]?.body))).toMatchObject({
      address: "354 Stockton St, Princeton, NJ 08540, USA",
      google_place_id: "ChIJ-selected",
    });
  });
});
