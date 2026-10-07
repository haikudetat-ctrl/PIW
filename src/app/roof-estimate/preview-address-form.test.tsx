import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/components/turnstile/turnstile", () => ({
  TurnstileWidget: ({onToken}: {onToken(token: string): void}) => (
    <button type="button" onClick={() => onToken("turnstile-token")}>Complete check</button>
  ),
}));
vi.mock("./quiet/quiet-address-search", () => ({
  QuietAddressSearch: ({onSelect, onUnavailable}: {
    onSelect(value: {placeId: string; address: string}): void;
    onUnavailable(): void;
  }) => (
    <>
      <button type="button" onClick={() => onSelect({placeId: "ChIJ-one", address: "1 Main St, Newark, NJ 07102, USA"})}>Pick address</button>
      <button type="button" onClick={onUnavailable}>Search unavailable</button>
    </>
  ),
}));

import { PreviewAddressForm } from "./preview-address-form";

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, "location", {value: {...window.location, assign}, configurable: true});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PreviewAddressForm", () => {
  test("shows the property-processing notice naming the button, with no checkboxes", () => {
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    expect(screen.getByTestId("preview-address-notice").textContent)
      .toBe("By clicking “See my roof,” you authorize All Season Solar to review this address using property records, maps, and imagery.");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByLabelText(/email|phone|name/i)).toBeNull();
  });

  test("creates a preview for the selected Google address and continues to it", async () => {
    const fetchMock = vi.fn(async () => Response.json({previewUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/token"}, {status: 201}));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    fireEvent.click(screen.getByRole("button", {name: "Pick address"}));
    fireEvent.click(screen.getByRole("button", {name: "Complete check"}));
    fireEvent.click(screen.getByRole("button", {name: "See my roof"}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://estimate.allseasonroofingquote.com/roof-estimate/p/token"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/property-preview");
    expect(JSON.parse(String(init.body))).toEqual({
      address: "1 Main St, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-one",
      turnstile_token: "turnstile-token",
    });
  });

  test("requires a selected address before submitting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    fireEvent.click(screen.getByRole("button", {name: "See my roof"}));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("submits a manual address without a Place ID", async () => {
    const fetchMock = vi.fn(async () => Response.json({previewUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/token"}, {status: 201}));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    fireEvent.click(screen.getByRole("button", {name: "Can’t find it? Enter the address manually"}));
    fireEvent.change(screen.getByLabelText("Street address"), {target: {value: "12 Birch Street"}});
    fireEvent.change(screen.getByLabelText("City"), {target: {value: "Trenton"}});
    fireEvent.change(screen.getByLabelText("ZIP code"), {target: {value: "08608"}});
    fireEvent.click(screen.getByRole("button", {name: "Complete check"}));
    fireEvent.click(screen.getByRole("button", {name: "See my roof"}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      address: "12 Birch Street, Trenton, NJ 08608",
      google_place_id: null,
      turnstile_token: "turnstile-token",
    });
  });

  test("asks the homeowner to try again after a failed check or rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({error: "rate_limited"}, {status: 429})));
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    fireEvent.click(screen.getByRole("button", {name: "Pick address"}));
    fireEvent.click(screen.getByRole("button", {name: "Complete check"}));
    fireEvent.click(screen.getByRole("button", {name: "See my roof"}));
    expect((await screen.findByRole("alert")).textContent).toMatch(/try again/i);
    expect(assign).not.toHaveBeenCalled();
  });

  test("starts in Google search with manual entry offered as a fallback", () => {
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    expect(screen.getByRole("button", {name: "Pick address"})).toBeTruthy();
    expect(screen.queryByLabelText("Street address")).toBeNull();
    expect(screen.getByRole("button", {name: "Can’t find it? Enter the address manually"})).toBeTruthy();
  });

  test("falls back to manual entry when Google search is unavailable", () => {
    render(<PreviewAddressForm turnstileSiteKey="site" brandName="All Season Solar" />);
    fireEvent.click(screen.getByRole("button", {name: "Search unavailable"}));
    expect(screen.getByLabelText("Street address")).toBeTruthy();
    expect(screen.getByRole("button", {name: "Use Google address search"})).toBeTruthy();
  });
});
