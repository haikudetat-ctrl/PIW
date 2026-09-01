// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({advertising: false, pathname: "/campaigns/seasonal-shield"}));

vi.mock("./privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({preferences: {advertising: state.advertising}}),
}));

vi.mock("next/navigation", () => ({usePathname: () => state.pathname}));

import {MetaPixelProvider, useMetaPixel} from "./meta-pixel-provider";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean})
  .IS_REACT_ACT_ENVIRONMENT = true;

type BrowserFbq = ReturnType<typeof vi.fn>;
const mountedRoots: Root[] = [];

function TrackerCapture({onReady}: {onReady: (track: ReturnType<typeof useMetaPixel>["trackConversion"]) => void}) {
  onReady(useMetaPixel().trackConversion);
  return null;
}

async function renderProvider(
  onReady: (track: ReturnType<typeof useMetaPixel>["trackConversion"]) => void = () => undefined,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(
    <MetaPixelProvider><TrackerCapture onReady={onReady} /></MetaPixelProvider>,
  ));
  return {container, root};
}

function currentFbq() {
  return (window as Window & {fbq?: BrowserFbq}).fbq;
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  document.head.querySelectorAll('script[src*="connect.facebook.net"]').forEach((script) => script.remove());
  delete (window as Window & {fbq?: BrowserFbq}).fbq;
  delete (window as Window & {_fbq?: BrowserFbq})._fbq;
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "3142520615938086");
  state.advertising = false;
  state.pathname = "/campaigns/seasonal-shield";
});

describe("website MetaPixelProvider", () => {
  test("does not load or touch Meta while advertising is denied", async () => {
    await renderProvider();

    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(currentFbq()).toBeUndefined();
  });

  test("grant loads once and tracks the current PageView once", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    const {root} = await renderProvider();
    await act(async () => root.render(
      <MetaPixelProvider><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>,
    ));

    expect(document.querySelectorAll('script[src*="connect.facebook.net"]')).toHaveLength(1);
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1);
  });

  test("tracks a server envelope once with eventID", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    await renderProvider((track) => {
      trackConversion = track;
    });
    const envelope = {
      name: "Lead" as const,
      eventId: "11111111-1111-4111-8111-111111111111",
      issuedAt: new Date().toISOString(),
    };

    trackConversion?.(envelope);
    trackConversion?.(envelope);

    expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: envelope.eventId});
    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(1);
  });
});
