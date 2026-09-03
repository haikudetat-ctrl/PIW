// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({
  advertising: true,
  pathname: "/contact",
}));

vi.mock("./privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({
    preferences: {advertising: state.advertising},
    authorizeAdvertising: async () => state.advertising,
  }),
}));

vi.mock("next/navigation", () => ({usePathname: () => state.pathname}));

import {LeadWebhookForm} from "./lead-webhook-form";
import {MetaPixelProvider} from "./meta-pixel-provider";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean})
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const eventEnvelope = {
  name: "Lead" as const,
  eventId: "11111111-1111-4111-8111-111111111111",
  issuedAt: new Date().toISOString(),
};
type BrowserFbq = ReturnType<typeof vi.fn>;

async function renderForm() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(<MetaPixelProvider enabled><LeadWebhookForm /></MetaPixelProvider>));
  return {container, root};
}

function fill(container: HTMLElement, name: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!field) throw new Error(`Missing field: ${name}`);
  field.value = value;
}

async function submitValidForm(container: HTMLElement) {
  fill(container, "name", "Jane Doe");
  fill(container, "email", "jane@example.com");
  fill(container, "phone", "856-555-0100");
  fill(container, "address", "1 Main Street, Vineland, NJ");
  await act(async () => container.querySelector("form")?.dispatchEvent(
    new Event("submit", {bubbles: true, cancelable: true}),
  ));
}

beforeEach(() => {
  state.advertising = true;
  state.pathname = "/contact";
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "3142520615938086");
  (window as unknown as {fbq?: BrowserFbq}).fbq = vi.fn() as BrowserFbq;
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  document.head.querySelectorAll('script[src*="connect.facebook.net"]').forEach((script) => script.remove());
  delete (window as Window & {fbq?: BrowserFbq}).fbq;
  delete (window as Window & {_fbq?: BrowserFbq})._fbq;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function leadCalls() {
  const fbq = (window as Window & {fbq?: BrowserFbq}).fbq;
  return fbq?.mock.calls.filter((call) => call[1] === "Lead") ?? [];
}

describe("LeadWebhookForm Meta Lead", () => {
  test("emits the server-issued Lead envelope after successful intake", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({accepted: true, metaEvent: eventEnvelope}));
    const {container} = await renderForm();
    expect((window as Window & {fbq?: BrowserFbq}).fbq).toHaveBeenCalledWith("track", "PageView");

    await submitValidForm(container);

    await vi.waitFor(() => expect(leadCalls()).toContainEqual(
      ["track", "Lead", {}, {eventID: eventEnvelope.eventId}],
    ));
  });

  test("does not emit a Lead after advertising consent is revoked during intake", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    const {container, root} = await renderForm();

    fill(container, "name", "Jane Doe");
    fill(container, "email", "jane@example.com");
    fill(container, "phone", "856-555-0100");
    fill(container, "address", "1 Main Street, Vineland, NJ");
    await act(async () => container.querySelector("form")?.dispatchEvent(
      new Event("submit", {bubbles: true, cancelable: true}),
    ));
    state.advertising = false;
    await act(async () => root.render(
      <MetaPixelProvider enabled><LeadWebhookForm /></MetaPixelProvider>,
    ));
    await act(async () => resolveResponse?.(Response.json({accepted: true, metaEvent: eventEnvelope})));

    await vi.waitFor(() => expect(container.querySelector(".status")?.textContent)
      .toContain("Thanks — your request is in."));

    expect(leadCalls()).toHaveLength(0);
  });

  test("does not emit a Lead when the accepted response omits its envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({accepted: true}));
    const {container} = await renderForm();

    await submitValidForm(container);

    expect(leadCalls()).toHaveLength(0);
  });

  test("does not emit a Lead after a failed submission", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {status: 502}));
    const {container} = await renderForm();

    await submitValidForm(container);

    expect(leadCalls()).toHaveLength(0);
  });
});
