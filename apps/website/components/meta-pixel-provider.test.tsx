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

  test("does not load Meta when the public pixel ID is unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    state.advertising = true;
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

  test("uses the current consent when an earlier async callback resolves", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let staleTrack: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    const {root} = await renderProvider((track) => {
      staleTrack = track;
    });
    let resolveRequest: (() => void) | undefined;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }).then(() => staleTrack?.({
      name: "Lead",
      eventId: "22222222-2222-4222-8222-222222222222",
      issuedAt: new Date().toISOString(),
    }));
    state.advertising = false;
    await act(async () => root.render(
      <MetaPixelProvider><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>,
    ));
    resolveRequest?.();
    await request;

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
  });

  test("tracks each return to a public route", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    const {root} = await renderProvider();
    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1);
    state.pathname = "/campaigns/weather-report";
    await act(async () => root.render(
      <MetaPixelProvider><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>,
    ));
    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(2);
    state.pathname = "/campaigns/seasonal-shield";
    await act(async () => root.render(
      <MetaPixelProvider><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>,
    ));

    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(3);
  });

  test("rejects malformed envelopes and tracks AssessmentCompleted without payload data", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    await renderProvider((track) => {
      trackConversion = track;
    });
    const now = new Date();

    trackConversion?.({
      name: "Lead",
      eventId: "not-a-uuid",
      issuedAt: now.toISOString(),
    });
    trackConversion?.({
      name: "Lead",
      eventId: "44444444-4444-4444-8444-444444444444",
      issuedAt: new Date(now.getTime() - (11 * 60 * 1000)).toISOString(),
    });
    trackConversion?.({
      name: "Unknown",
      eventId: "55555555-5555-4555-8555-555555555555",
      issuedAt: now.toISOString(),
    } as never);
    trackConversion?.({
      name: "AssessmentCompleted",
      eventId: "66666666-6666-4666-8666-666666666666",
      issuedAt: now.toISOString(),
    });

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
    expect(fbq).toHaveBeenCalledWith(
      "trackCustom",
      "AssessmentCompleted",
      {},
      {eventID: "66666666-6666-4666-8666-666666666666"},
    );
  });
});
