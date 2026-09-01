import {existsSync} from "node:fs";
import {readFileSync} from "node:fs";
import path from "node:path";
// @ts-expect-error -- jsdom is supplied by the workspace test runtime.
import {JSDOM} from "jsdom";
import {describe, expect, test, vi} from "vitest";

const runtime = readFileSync(path.join(__dirname, "privacy-runtime.js"), "utf8");
const consentId = "11111111-1111-4111-8111-111111111111";

function verifiedConsent(advertising: boolean) {
  return {
    policyVersion: "piw-privacy-v1",
    consentId,
    preferences: {necessary: true, analytics: false, advertising},
    gpcDetected: false,
    updatedAt: "2026-09-01T16:00:00.000Z",
  };
}

function runtimeDom() {
  const dom = new JSDOM(`<!doctype html><html><head>
    <script id="all-season-meta-config" type="application/json">{"enabled":true,"pixelId":"3142520615938086"}</script>
  </head><body><main>Public page</main></body></html>`, {
    url: "https://allseason.example/about.html",
    runScripts: "outside-only",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({matches: false}),
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0),
  });
  return dom;
}

async function boot(dom: JSDOM) {
  dom.window.eval(runtime);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

describe("static privacy runtime", () => {
  test("is available to every injected public page", () => {
    expect(existsSync(path.join(__dirname, "privacy-runtime.js"))).toBe(true);
    expect(existsSync(path.join(__dirname, "privacy-runtime.css"))).toBe(true);
  });

  test("keeps Meta and residual attribution cookies untouched until verified advertising consent", async () => {
    const dom = runtimeDom();
    dom.window.document.cookie = "_fbp=fb.1.residual";
    dom.window.document.cookie = "_fbc=fb.1.residual";
    const fetch = vi.fn(async () => Response.json({consent: verifiedConsent(false)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);

    (dom.window as Window & {AllSeasonMeta?: {trackConversion(value: unknown): void}})
      .AllSeasonMeta?.trackConversion({
        name: "Lead",
        eventId: "22222222-2222-4222-8222-222222222222",
        issuedAt: new Date().toISOString(),
      });

    expect(fetch).toHaveBeenCalledWith("/api/privacy/consent", expect.objectContaining({
      credentials: "same-origin",
    }));
    expect(dom.window.document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect((dom.window as Window & {fbq?: unknown}).fbq).toBeUndefined();
    expect(dom.window.document.querySelector('[data-all-season-privacy-reopen]')).not.toBeNull();
  });

  test("loads one Pixel PageView only after the server verifies advertising consent", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn(async () => Response.json({consent: verifiedConsent(true)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);

    expect(dom.window.document.querySelectorAll('script[src*="connect.facebook.net"]')).toHaveLength(1);
    expect(fbq).toHaveBeenCalledWith("init", "3142520615938086");
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
  });

  test("emits a valid server envelope once without custom property data", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn(async () => Response.json({consent: verifiedConsent(true)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);
    const envelope = {
      name: "Lead",
      eventId: "33333333-3333-4333-8333-333333333333",
      issuedAt: new Date().toISOString(),
    };
    (dom.window as Window & {AllSeasonMeta?: {trackConversion(value: unknown): void}})
      .AllSeasonMeta?.trackConversion(envelope);
    (dom.window as Window & {AllSeasonMeta?: {trackConversion(value: unknown): void}})
      .AllSeasonMeta?.trackConversion(envelope);

    expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: envelope.eventId});
    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(1);
  });

  test("keeps the saved privacy controls usable after accepting advertising", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({consent: null}))
      .mockResolvedValueOnce(Response.json({consent: verifiedConsent(true)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);
    const accept = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Accept all");
    accept?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));

    await vi.waitFor(() => expect(fbq).toHaveBeenCalledWith("track", "PageView"));
    const reopen = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-all-season-privacy-reopen]',
    );
    expect(reopen?.disabled).toBe(false);
  });

  test("opens a styled modal dialog from the privacy controls", async () => {
    const dom = runtimeDom();
    dom.window.fetch = vi.fn(async () => Response.json({consent: null})) as typeof dom.window.fetch;

    await boot(dom);
    const customize = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Customize");
    customize?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));

    const dialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-describedby"))
      .toBe("all-season-privacy-dialog-description");
    expect(dialog?.parentElement?.dataset.allSeasonPrivacyModal).toBe("true");
    expect(readFileSync(path.join(__dirname, "privacy-runtime.css"), "utf8"))
      .toContain(".all-season-privacy-modal");
  });

  test("keeps an actionable modal open when saving privacy choices fails", async () => {
    const dom = runtimeDom();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({consent: null}))
      .mockResolvedValueOnce(new Response(null, {status: 503}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);
    const customize = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Customize");
    customize?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));
    const save = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Save preferences");
    save?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));

    await vi.waitFor(() => expect(dom.window.document.querySelector('[role="alert"]')?.textContent)
      .toBe("We could not save your privacy choices. Please try again."));
    expect(dom.window.document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
  });
});
