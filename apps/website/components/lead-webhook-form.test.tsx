// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({trackConversion: vi.fn()}));

vi.mock("./meta-pixel-provider", () => ({
  useMetaPixel: () => ({trackConversion: state.trackConversion}),
}));

import {LeadWebhookForm} from "./lead-webhook-form";

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
  await act(async () => root.render(<LeadWebhookForm />));
  return container;
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
  state.trackConversion.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("LeadWebhookForm Meta Lead", () => {
  test("emits the server-issued Lead envelope after successful intake", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({accepted: true, metaEvent: eventEnvelope}));
    const container = await renderForm();

    await submitValidForm(container);

    expect(state.trackConversion).toHaveBeenCalledWith(eventEnvelope);
  });

  test("does not emit a Lead when advertising consent did not reserve an envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({accepted: true, metaEvent: null}));
    const container = await renderForm();

    await submitValidForm(container);

    expect(state.trackConversion).not.toHaveBeenCalled();
  });

  test("does not emit a Lead when the accepted response omits its envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({accepted: true}));
    const container = await renderForm();

    await submitValidForm(container);

    expect(state.trackConversion).not.toHaveBeenCalled();
  });

  test("does not emit a Lead after a failed submission", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {status: 502}));
    const container = await renderForm();

    await submitValidForm(container);

    expect(state.trackConversion).not.toHaveBeenCalled();
  });
});
