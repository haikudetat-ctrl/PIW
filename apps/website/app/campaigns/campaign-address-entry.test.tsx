// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

vi.mock("../../components/turnstile", () => ({
  TurnstileWidget: ({onToken}: {onToken(token: string): void}) => (
    <button type="button" onClick={() => onToken("turnstile-token")}>Complete check</button>
  ),
}));
vi.mock("./address-autocomplete", () => ({
  AddressAutocomplete: ({onSelect}: {onSelect(value: {placeId: string; address: string}): void}) => (
    <button type="button" onClick={() => onSelect({placeId: "ChIJ-one", address: "1 Main St, Newark, NJ 07102, USA"})}>Pick address</button>
  ),
}));

import {CampaignAddressEntry} from "./campaign-address-entry";
import {campaigns} from "./campaigns";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const previewUrl = `https://estimate.allseasonroofingquote.com/roof-estimate/p/${"t".repeat(43)}`;
let assign: ReturnType<typeof vi.fn>;

async function renderEntry() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<CampaignAddressEntry campaign={campaigns["weather-report"]} turnstileSiteKey="site" />));
  return container;
}

function button(container: HTMLElement, label: string) {
  const found = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, "location", {value: {...window.location, assign, search: "?utm_source=facebook&fbclid=abc", pathname: "/campaigns/weather-report"}, configurable: true});
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("CampaignAddressEntry", () => {
  test("shows only the address step with the property-processing notice", async () => {
    const container = await renderEntry();
    expect(container.querySelector("[data-preview-notice]")?.textContent)
      .toBe("By clicking “See my roof,” you authorize All Season Solar to review this address using property records, maps, and imagery.");
    expect(container.querySelectorAll('input[type="checkbox"], input[type="email"], input[type="tel"]')).toHaveLength(0);
  });

  test("creates the preview with campaign context and continues to it", async () => {
    const fetchMock = vi.fn(async () => Response.json({previewUrl}, {status: 201}));
    vi.stubGlobal("fetch", fetchMock);
    const container = await renderEntry();
    await act(async () => button(container, "Pick address").click());
    await act(async () => button(container, "Complete check").click());
    await act(async () => button(container, "See my roof").click());
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(previewUrl));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/property-preview");
    expect(JSON.parse(String(init.body))).toEqual({
      address: "1 Main St, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-one",
      campaign: "weather-report",
      entry_point: "campaign:weather-report",
      presentation_key: "weather-report",
      turnstile_token: "turnstile-token",
      utm_source: "facebook",
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      fbclid: "abc",
    });
  });

  test("asks for an address before submitting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const container = await renderEntry();
    await act(async () => button(container, "See my roof").click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
