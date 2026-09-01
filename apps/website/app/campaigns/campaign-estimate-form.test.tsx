// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({
  advertising: true,
  pathname: "/campaigns/seasonal-shield",
}));

vi.mock("../../components/privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({preferences: {advertising: state.advertising}}),
}));

vi.mock("next/navigation", () => ({usePathname: () => state.pathname}));

vi.mock("./address-autocomplete", () => ({
  AddressAutocomplete: ({onUnavailable}: {onUnavailable: () => void}) => (
    <button type="button" onClick={onUnavailable}>Use manual address</button>
  ),
}));

import {CampaignEstimateForm} from "./campaign-estimate-form";
import {campaigns} from "./campaigns";
import {MetaPixelProvider} from "../../components/meta-pixel-provider";

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
  await act(async () => root.render(
    <MetaPixelProvider><CampaignEstimateForm campaign={campaigns["seasonal-shield"]} /></MetaPixelProvider>,
  ));
  return {container, root};
}

function button(container: HTMLElement, label: string) {
  const result = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function fill(container: HTMLElement, name: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!field) throw new Error(`Missing field: ${name}`);
  field.value = value;
  field.dispatchEvent(new Event("input", {bubbles: true}));
}

async function submitValidCampaignForm(container: HTMLElement) {
  await click(button(container, "Can’t find it?"));
  fill(container, "address_line_1", "1 Main Street");
  fill(container, "city", "Vineland");
  fill(container, "postal_code", "08360");
  await click(button(container, "Continue to your details"));
  fill(container, "name", "Jane Doe");
  fill(container, "email", "jane@example.com");
  fill(container, "phone", "856-555-0100");
  for (const checkbox of Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", {bubbles: true}));
  }
  await act(async () => container.querySelector("form")?.dispatchEvent(
    new Event("submit", {bubbles: true, cancelable: true}),
  ));
}

beforeEach(() => {
  state.advertising = true;
  state.pathname = "/campaigns/seasonal-shield";
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

describe("CampaignEstimateForm Meta Lead", () => {
  test("emits the server-issued Lead envelope before redirecting after success", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({estimateUrl: "/roof-estimate/continue/token", metaEvent: eventEnvelope}));
    const {container} = await renderForm();
    expect((window as Window & {fbq?: BrowserFbq}).fbq).toHaveBeenCalledWith("track", "PageView");

    await submitValidCampaignForm(container);

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

    await click(button(container, "Can’t find it?"));
    fill(container, "address_line_1", "1 Main Street");
    fill(container, "city", "Vineland");
    fill(container, "postal_code", "08360");
    await click(button(container, "Continue to your details"));
    fill(container, "name", "Jane Doe");
    fill(container, "email", "jane@example.com");
    fill(container, "phone", "856-555-0100");
    for (const checkbox of Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", {bubbles: true}));
    }
    await act(async () => container.querySelector("form")?.dispatchEvent(
      new Event("submit", {bubbles: true, cancelable: true}),
    ));
    state.advertising = false;
    await act(async () => root.render(
      <MetaPixelProvider><CampaignEstimateForm campaign={campaigns["seasonal-shield"]} /></MetaPixelProvider>,
    ));
    const completed = new Promise<void>((resolve) => {
      window.addEventListener("allseason:campaign_form_success", () => resolve(), {once: true});
    });
    await act(async () => resolveResponse?.(Response.json({
      estimateUrl: "/roof-estimate/continue/token",
      metaEvent: eventEnvelope,
    })));
    await completed;

    expect(leadCalls()).toHaveLength(0);
  });

  test("does not emit a Lead when the accepted response omits its envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({estimateUrl: "/roof-estimate/continue/token"}));
    const {container} = await renderForm();

    await submitValidCampaignForm(container);

    expect(leadCalls()).toHaveLength(0);
  });

  test("does not emit a Lead after a failed submission", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {status: 502}));
    const {container} = await renderForm();

    await submitValidCampaignForm(container);

    expect(leadCalls()).toHaveLength(0);
  });
});
