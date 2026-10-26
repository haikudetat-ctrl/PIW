import {render, screen, waitFor} from "@testing-library/react";
import type {ComponentType, ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import type {VerifiedConsent} from "@/modules/privacy/consent";

const navigation = vi.hoisted(() => ({pathname: "/roof-estimate" as string | null}));
vi.mock("next/navigation", () => ({usePathname: () => navigation.pathname}));

type ProviderModule = {
  PrivacyConsentProvider: ComponentType<{children: ReactNode; initialConsent: VerifiedConsent | null}>;
  usePrivacyConsent: () => {preferences: {advertising: boolean}; status: string};
};

const noticeDefault: VerifiedConsent = {
  policyVersion: "piw-privacy-v1",
  consentId: "11111111-1111-4111-8111-111111111111",
  preferences: {necessary: true, analytics: false, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-10-26T12:00:00.000Z",
};

async function renderProvider(initialConsent: VerifiedConsent | null) {
  vi.resetModules();
  const {PrivacyConsentProvider, usePrivacyConsent} = await import("./privacy-consent-provider") as unknown as ProviderModule;
  function Probe() {
    const {preferences, status} = usePrivacyConsent();
    return <output data-testid="state">{`${status}:${preferences.advertising}`}</output>;
  }
  render(<PrivacyConsentProvider initialConsent={initialConsent}><Probe /></PrivacyConsentProvider>);
}

function postBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map((call) => call[1] as RequestInit | undefined)
    .filter((init) => init?.method === "POST")
    .map((init) => JSON.parse(String(init?.body)));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADVERTISING_DEFAULT_ON", "true");
  navigation.pathname = "/roof-estimate";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, "globalPrivacyControl", {value: undefined, configurable: true});
});

describe("estimate host notice default (opt-out advertising)", () => {
  test("records the default on arrival and shows only the Privacy choices control", async () => {
    const fetchMock = vi.fn(async () => Response.json({consent: noticeDefault}));
    vi.stubGlobal("fetch", fetchMock);

    await renderProvider(null);

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("saved:true"));
    expect(postBodies(fetchMock)).toEqual([{
      analytics: false,
      advertising: true,
      gpcDetected: false,
      source: "default_notice",
    }]);
    expect(screen.getByRole("button", {name: "Privacy choices"})).toBeVisible();
    expect(screen.queryByRole("button", {name: "Accept"})).toBeNull();
  });

  test("never records a default under Global Privacy Control", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {value: true, configurable: true});
    const fetchMock = vi.fn(async () => Response.json({consent: noticeDefault}));
    vi.stubGlobal("fetch", fetchMock);

    await renderProvider(null);

    await waitFor(() => expect(screen.getByRole("button", {name: "Accept"})).toBeVisible());
    expect(postBodies(fetchMock).some((body) => body.source === "default_notice")).toBe(false);
    expect(screen.getByTestId("state")).toHaveTextContent("unset:false");
  });

  test("falls back to the opt-in banner when the default cannot be recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({error: "unavailable"}, {status: 503})));

    await renderProvider(null);

    await waitFor(() => expect(screen.getByRole("button", {name: "Accept"})).toBeVisible());
    expect(screen.getByTestId("state")).toHaveTextContent("unset:false");
  });

  test("leaves a saved choice alone", async () => {
    const rejection = {...noticeDefault, preferences: {...noticeDefault.preferences, advertising: false}};
    const fetchMock = vi.fn(async () => Response.json({consent: rejection}));
    vi.stubGlobal("fetch", fetchMock);

    await renderProvider(rejection);

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("saved:false"));
    expect(postBodies(fetchMock)).toHaveLength(0);
  });

  test("records nothing on staff pages", async () => {
    navigation.pathname = "/pipeline";
    const fetchMock = vi.fn(async () => Response.json({consent: noticeDefault}));
    vi.stubGlobal("fetch", fetchMock);

    await renderProvider(null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {name: "Privacy choices"})).toBeNull();
  });
});
