// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, describe, expect, test, vi} from "vitest";
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

async function renderConsent(initialConsent: typeof rejectedConsent | null, children = <div />) {
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

  test("starts from server-verified consent without showing the first-visit banner", async () => {
    const container = await renderConsent(rejectedConsent, <Probe />);

    expect(container.querySelector('section[aria-label="Privacy choices"]')).toBeNull();
    expect(container.querySelector("output")?.textContent).toContain('"decided":true');
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
