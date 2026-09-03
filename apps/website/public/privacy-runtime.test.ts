import {existsSync} from "node:fs";
import {readFileSync} from "node:fs";
import path from "node:path";
// @ts-expect-error -- jsdom is supplied by the workspace test runtime.
import {JSDOM} from "jsdom";
import {describe, expect, test, vi} from "vitest";

const runtime = readFileSync(path.join(__dirname, "privacy-runtime.js"), "utf8");
const consentId = "11111111-1111-4111-8111-111111111111";

type StaticMetaRuntime = {
  trackConversion(value: unknown): void;
  trackConversionBeforeNavigation(value: unknown): Promise<void>;
};

function metaRuntime(dom: JSDOM) {
  return (dom.window as Window & {AllSeasonMeta?: StaticMetaRuntime}).AllSeasonMeta;
}

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

  test("active browser GPC suppresses a returned grant before Pixel initialization", async () => {
    const dom = runtimeDom();
    Object.defineProperty(dom.window.navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn(async () => Response.json({consent: verifiedConsent(true)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);

    expect(fetch).toHaveBeenCalledWith("/api/privacy/consent", expect.objectContaining({
      headers: expect.objectContaining({"x-all-season-gpc": "1"}),
    }));
    expect(dom.window.document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(0);
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

    await vi.waitFor(() => expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: envelope.eventId}));
    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(1);
  });

  test("revalidates before conversion and suppresses a mounted static page after revocation", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({consent: verifiedConsent(true)}))
      .mockResolvedValue(Response.json({consent: verifiedConsent(false)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;
    await boot(dom);

    metaRuntime(dom)?.trackConversion({
      name: "Lead",
      eventId: "34333333-3333-4333-8333-333333333333",
      issuedAt: new Date().toISOString(),
    });
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
  });

  test("does not let a delayed boot grant overwrite a newer focus denial", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    let resolveBoot: ((response: Response) => void) | undefined;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveBoot = resolve; }))
      .mockResolvedValueOnce(Response.json({consent: verifiedConsent(false)}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    dom.window.eval(runtime);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    resolveBoot?.(Response.json({consent: verifiedConsent(true)}));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(0);
  });

  test("waits for a pending verified consent read before emitting a server-issued Lead", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    let resolveStatus!: (response: Response) => void;
    const pendingStatus = new Promise<Response>((resolve) => {
      resolveStatus = resolve;
    });
    const fetch = vi.fn((url: string) => {
      if (url === "/api/privacy/consent") {
        return fetch.mock.calls.length === 1
          ? pendingStatus
          : Promise.resolve(Response.json({consent: verifiedConsent(true)}));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);
    const runtimeApi = metaRuntime(dom);
    if (!runtimeApi) throw new Error("Missing static Meta runtime");
    const envelope = {
      name: "Lead",
      eventId: "44444444-4444-4444-8444-444444444444",
      issuedAt: new Date().toISOString(),
    };
    const completed = runtimeApi.trackConversionBeforeNavigation(envelope);

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);

    resolveStatus(Response.json({consent: verifiedConsent(true)}));
    await completed;

    expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: envelope.eventId});
  });

  test("releases a waiting form without a Lead when consent readiness times out", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);
    const runtimeApi = metaRuntime(dom);
    if (!runtimeApi) throw new Error("Missing static Meta runtime");

    await runtimeApi.trackConversionBeforeNavigation({
      name: "Lead",
      eventId: "55555555-5555-4555-8555-555555555555",
      issuedAt: new Date().toISOString(),
    });

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
  });

  test("releases a waiting form without a Lead when consent readiness fails", async () => {
    const dom = runtimeDom();
    const fbq = vi.fn();
    Object.defineProperty(dom.window, "fbq", {value: fbq, configurable: true});
    const fetch = vi.fn(async () => new Response(null, {status: 503}));
    dom.window.fetch = fetch as typeof dom.window.fetch;

    await boot(dom);
    const runtimeApi = metaRuntime(dom);
    if (!runtimeApi) throw new Error("Missing static Meta runtime");

    await runtimeApi.trackConversionBeforeNavigation({
      name: "Lead",
      eventId: "66666666-6666-4666-8666-666666666666",
      issuedAt: new Date().toISOString(),
    });

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
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

  test("returns focus to the still-connected static trigger when the modal is canceled", async () => {
    const dom = runtimeDom();
    dom.window.fetch = vi.fn(async () => Response.json({consent: null})) as typeof dom.window.fetch;

    await boot(dom);
    const customize = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Customize");
    if (!customize) throw new Error("Missing Customize control");
    customize.focus();
    customize.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));
    const cancel = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Cancel");
    cancel?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));

    expect(customize.isConnected).toBe(true);
    expect(dom.window.document.activeElement).toBe(customize);
  });

  test("focuses the newly rendered static Privacy choices control after saving", async () => {
    const dom = runtimeDom();
    dom.window.fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({consent: null}))
      .mockResolvedValueOnce(Response.json({consent: verifiedConsent(false)})) as typeof dom.window.fetch;

    await boot(dom);
    const customize = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Customize");
    customize?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));
    const save = (Array.from(dom.window.document.querySelectorAll("button")) as unknown as HTMLButtonElement[])
      .find((button) => button.textContent === "Save preferences");
    save?.dispatchEvent(new dom.window.MouseEvent("click", {bubbles: true}));

    await vi.waitFor(() => {
      const reopen = dom.window.document.querySelector<HTMLButtonElement>(
        '[data-all-season-privacy-reopen]',
      );
      expect(reopen?.isConnected).toBe(true);
      expect(dom.window.document.activeElement).toBe(reopen);
    });
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
