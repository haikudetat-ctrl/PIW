// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import path from "node:path";
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, describe, expect, test, vi} from "vitest";
import type {VerifiedWebsiteConsent} from "../lib/privacy-consent";
import {
  PrivacyConsentProvider,
  usePrivacyConsent,
} from "./privacy-consent-provider";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean})
  .IS_REACT_ACT_ENVIRONMENT = true;

const rejectedConsent = {
  policyVersion: "piw-privacy-v1" as const,
  consentId: "11111111-1111-4111-8111-111111111111",
  preferences: {necessary: true as const, analytics: false, advertising: false},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};
const mountedRoots: Root[] = [];

function Probe() {
  const consent = usePrivacyConsent();
  return <output data-testid="privacy-state">{JSON.stringify(consent)}</output>;
}

async function renderConsent(initialConsent: VerifiedWebsiteConsent | null, children = <div />) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      <PrivacyConsentProvider initialConsent={initialConsent}>
        {children}
      </PrivacyConsentProvider>,
    );
  });
  return container;
}

function button(container: HTMLElement, name: string) {
  const found = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "globalPrivacyControl", {
    value: undefined,
    configurable: true,
  });
});

describe("website privacy consent", () => {
  test("offers equally prominent Accept, Reject, and Customize controls", async () => {
    const container = await renderConsent(null);
    const choices = container.querySelector('[aria-label="Privacy choices"]');

    expect(choices).not.toBeNull();
    expect(choices?.contains(button(container, "Accept all"))).toBe(true);
    expect(choices?.contains(button(container, "Reject nonessential"))).toBe(true);
    expect(choices?.contains(button(container, "Customize"))).toBe(true);
  });

  test("rejects nonessential consent and updates the public context", async () => {
    const fetchMock = vi.fn(async () => Response.json({consent: rejectedConsent}));
    vi.stubGlobal("fetch", fetchMock);
    const container = await renderConsent(null, <Probe />);

    await click(button(container, "Reject nonessential"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/privacy/consent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({analytics: false, advertising: false}),
      }),
    ));
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent)
      .toContain('"decided":true'));
    expect(container.querySelector("output")?.textContent).toContain('"advertising":false');
  });

  test("customizes analytics and advertising independently", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const choices = JSON.parse(String(init?.body)) as {analytics: boolean; advertising: boolean};
      return Response.json({consent: {
        ...rejectedConsent,
        preferences: {necessary: true, ...choices},
      }});
    }));
    const container = await renderConsent(null, <Probe />);

    await click(button(container, "Customize"));
    const necessary = container.querySelector<HTMLInputElement>('input[aria-label="Necessary"]');
    const analytics = container.querySelector<HTMLInputElement>('input[aria-label="Analytics"]');
    expect(necessary?.disabled).toBe(true);
    if (!analytics) throw new Error("Missing Analytics control");
    await click(analytics);
    await click(button(container, "Save preferences"));

    await vi.waitFor(() => expect(container.querySelector("output")?.textContent)
      .toContain('"analytics":true'));
    expect(container.querySelector("output")?.textContent).toContain('"advertising":false');
  });

  test("opens a viewport-safe modal with an Escape close path", async () => {
    const container = await renderConsent(null);
    const customize = button(container, "Customize");
    customize.focus();

    await click(customize);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    expect(dialog?.getAttribute("aria-describedby")).toBe("privacy-dialog-description");
    expect(dialog?.parentElement?.classList.contains("privacy-consent-backdrop")).toBe(true);
    expect(readFileSync(path.join(process.cwd(), "app", "styles.css"), "utf8"))
      .toMatch(/\.privacy-consent-backdrop\s*\{[\s\S]*?position:\s*fixed/);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    });

    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(document.activeElement).toBe(customize);
  });

  test("focuses the connected Privacy choices control after first-time customization is saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({consent: rejectedConsent})));
    const container = await renderConsent(null);
    const customize = button(container, "Customize");
    customize.focus();

    await click(customize);
    await click(button(container, "Save preferences"));

    await vi.waitFor(() => {
      const reopen = container.querySelector<HTMLButtonElement>(".privacy-consent-reopen");
      expect(reopen?.isConnected).toBe(true);
      expect(document.activeElement).toBe(reopen);
    });
  });

  test("starts from server-verified consent without showing the first-visit banner", async () => {
    const container = await renderConsent(rejectedConsent, <Probe />);

    expect(container.querySelector('section[aria-label="Privacy choices"]')).toBeNull();
    expect(container.querySelector("output")?.textContent).toContain('"decided":true');
  });

  test("holds an initial Advertising grant until the canonical status resolves", async () => {
    const grant: VerifiedWebsiteConsent = {
      ...rejectedConsent,
      preferences: {necessary: true, analytics: true, advertising: true},
    };
    let finishStatus: ((response: Response) => void) | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Promise<Response>((resolve) => {
          finishStatus = resolve;
        });
      }
      throw new Error("Only the canonical status request is expected");
    });
    vi.stubGlobal("fetch", fetch);

    const container = await renderConsent(grant, <Probe />);

    expect(container.querySelector("output")?.textContent).toContain('"advertising":false');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/privacy/consent",
      expect.objectContaining({method: "GET", cache: "no-store"}),
    ));

    await act(async () => finishStatus?.(Response.json({consent: grant})));

    await vi.waitFor(() => expect(container.querySelector("output")?.textContent)
      .toContain('"advertising":true'));
  });

  test("active browser GPC suppresses an existing grant and synchronizes a denial", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    const grant: VerifiedWebsiteConsent = {
      ...rejectedConsent,
      preferences: {necessary: true, analytics: true, advertising: true},
    };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") {
        return Response.json({consent: {
          ...grant,
          preferences: {necessary: true, analytics: true, advertising: false},
          gpcDetected: true,
        }});
      }
      const body = JSON.parse(String(init?.body));
      return Response.json({consent: {
        ...grant,
        preferences: {necessary: true, analytics: body.analytics, advertising: false},
        gpcDetected: true,
      }});
    });
    vi.stubGlobal("fetch", fetch);
    const container = await renderConsent(grant, <Probe />);

    expect(container.querySelector("output")?.textContent).toContain('"advertising":false');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/privacy/consent",
      expect.objectContaining({
        body: JSON.stringify({analytics: true, advertising: false, gpcDetected: true}),
      }),
    ));
    await click(button(container, "Privacy choices"));
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Advertising"]')?.disabled).toBe(true);
    expect(container.textContent).not.toMatch(/turn it on|override/i);
  });

  test("fails closed and keeps choices visible when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503})));
    const container = await renderConsent(null, <Probe />);

    await click(button(container, "Accept all"));

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("We could not save your privacy choices. Please try again."));
    expect(container.querySelector('section[aria-label="Privacy choices"]')).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toContain('"decided":false');
  });

  test("fails closed when the endpoint returns an unverified consent shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({consent: {
      ...rejectedConsent,
      consentId: "not-a-uuid",
      updatedAt: "not-a-date",
      preferences: {necessary: true, analytics: true, advertising: true},
    }})));
    const container = await renderConsent(null, <Probe />);

    await click(button(container, "Accept all"));

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.querySelector("output")?.textContent).toContain('"decided":false');
    expect(container.querySelector("output")?.textContent).toContain('"advertising":false');
  });
});
