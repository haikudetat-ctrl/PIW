// @vitest-environment jsdom

import {act, type ComponentType, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import type {VerifiedWebsiteConsent} from "../lib/privacy-consent";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean})
  .IS_REACT_ACT_ENVIRONMENT = true;

type ProviderModule = {
  PrivacyConsentProvider: ComponentType<{children: ReactNode; initialConsent: VerifiedWebsiteConsent | null}>;
  usePrivacyConsent: () => {preferences: {advertising: boolean}; decided: boolean};
};

const consentId = "11111111-1111-4111-8111-111111111111";
const noticeDefault: VerifiedWebsiteConsent = {
  policyVersion: "piw-privacy-v1",
  consentId,
  preferences: {necessary: true, analytics: false, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-10-26T12:00:00.000Z",
};
const mountedRoots: Root[] = [];
let storage: Map<string, string>;

async function loadProvider(): Promise<ProviderModule> {
  vi.resetModules();
  return await import("./privacy-consent-provider") as unknown as ProviderModule;
}

async function render(initialConsent: VerifiedWebsiteConsent | null) {
  const {PrivacyConsentProvider, usePrivacyConsent} = await loadProvider();
  function Probe() {
    const consent = usePrivacyConsent();
    return <output data-testid="advertising">{String(consent.preferences.advertising)}</output>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(<PrivacyConsentProvider initialConsent={initialConsent}><Probe /></PrivacyConsentProvider>);
  });
  // Let the notice request resolve.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}

function buttons(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button")).map((node) => node.textContent?.trim());
}

function setGpc(value: boolean) {
  Object.defineProperty(navigator, "globalPrivacyControl", {configurable: true, value});
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADVERTISING_DEFAULT_ON", "true");
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() { return storage.size; },
  });
  setGpc(false);
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setGpc(false);
});

describe("website notice default (opt-out advertising)", () => {
  test("records the default on arrival and shows only the Privacy choices control", async () => {
    const fetch = vi.fn(async () => Response.json({consent: noticeDefault}));
    vi.stubGlobal("fetch", fetch);

    const container = await render(null);

    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      analytics: false,
      advertising: true,
      source: "default_notice",
    });
    expect(container.querySelector("[data-testid=advertising]")?.textContent).toBe("true");
    expect(buttons(container)).toContain("Privacy choices");
    expect(buttons(container)).not.toContain("Accept");
    // A notice default is not a choice, so it leaves no local denial behind.
    expect(storage.get("allseason-privacy-denials")).toBeUndefined();
  });

  test("never records a default under Global Privacy Control", async () => {
    setGpc(true);
    const fetch = vi.fn(async () => Response.json({consent: {...noticeDefault, gpcDetected: true, preferences: {...noticeDefault.preferences, advertising: false}}}));
    vi.stubGlobal("fetch", fetch);

    const container = await render(null);

    const bodies = fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies.some((body) => body.source === "default_notice")).toBe(false);
    expect(container.querySelector("[data-testid=advertising]")?.textContent).toBe("false");
  });

  test("respects a visitor's earlier local rejection", async () => {
    storage.set("allseason-privacy-denials", JSON.stringify({analytics: true, advertising: true}));
    const fetch = vi.fn(async () => Response.json({consent: noticeDefault}));
    vi.stubGlobal("fetch", fetch);

    const container = await render(null);

    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid=advertising]")?.textContent).toBe("false");
  });

  test("falls back to the opt-in banner when the default cannot be recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({error: "unavailable"}, {status: 503})));

    const container = await render(null);

    expect(container.querySelector("[data-testid=advertising]")?.textContent).toBe("false");
    expect(buttons(container)).toEqual(expect.arrayContaining(["Accept", "Decline"]));
    expect(buttons(container)).not.toContain("Privacy choices");
  });

  test("leaves a saved choice alone", async () => {
    const fetch = vi.fn(async () => Response.json({consent: {...noticeDefault, preferences: {...noticeDefault.preferences, advertising: false}}}));
    vi.stubGlobal("fetch", fetch);

    await render({...noticeDefault, preferences: {...noticeDefault.preferences, advertising: false}});

    const posts = fetch.mock.calls.filter((call) => (call as unknown as [string, RequestInit])[1]?.method === "POST");
    expect(posts).toHaveLength(0);
  });
});
