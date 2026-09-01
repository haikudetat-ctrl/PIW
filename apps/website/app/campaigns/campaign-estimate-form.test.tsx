// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({trackConversion: vi.fn()}));

vi.mock("../../components/meta-pixel-provider", () => ({
  useMetaPixel: () => ({trackConversion: state.trackConversion}),
}));

vi.mock("./address-autocomplete", () => ({
  AddressAutocomplete: ({onUnavailable}: {onUnavailable: () => void}) => (
    <button type="button" onClick={onUnavailable}>Use manual address</button>
  ),
}));

import {CampaignEstimateForm} from "./campaign-estimate-form";
import {campaigns} from "./campaigns";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean})
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const eventEnvelope = {
  name: "Lead" as const,
  eventId: "11111111-1111-4111-8111-111111111111",
  issuedAt: "2026-09-01T16:00:00.000Z",
};

async function renderForm() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(<CampaignEstimateForm campaign={campaigns["seasonal-shield"]} />));
  return container;
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
  state.trackConversion.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("CampaignEstimateForm Meta Lead", () => {
  test("emits the server-issued Lead envelope before redirecting after success", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({estimateUrl: "/roof-estimate/continue/token", metaEvent: eventEnvelope}));
    const container = await renderForm();

    await submitValidCampaignForm(container);

    expect(state.trackConversion).toHaveBeenCalledWith(eventEnvelope);
  });

  test("does not emit a Lead when advertising consent did not reserve an envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({estimateUrl: "/roof-estimate/continue/token", metaEvent: null}));
    const container = await renderForm();

    await submitValidCampaignForm(container);

    expect(state.trackConversion).not.toHaveBeenCalled();
  });

  test("does not emit a Lead when the accepted response omits its envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({estimateUrl: "/roof-estimate/continue/token"}));
    const container = await renderForm();

    await submitValidCampaignForm(container);

    expect(state.trackConversion).not.toHaveBeenCalled();
  });

  test("does not emit a Lead after a failed submission", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {status: 502}));
    const container = await renderForm();

    await submitValidCampaignForm(container);

    expect(state.trackConversion).not.toHaveBeenCalled();
  });
});
