// @vitest-environment jsdom

import {render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({
  advertising: false,
  enabled: true,
  pathname: "/roof-estimate/example",
  authorizeAdvertising: vi.fn(async () => true),
}));

vi.mock("@/components/privacy/privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({
    preferences: {advertising: state.advertising},
    authorizeAdvertising: state.authorizeAdvertising,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

import {MetaPixelProvider, useMetaPixel} from "./meta-pixel-provider";

type BrowserFbq = ReturnType<typeof vi.fn>;

function TrackerCapture({onReady}: {onReady: (track: ReturnType<typeof useMetaPixel>["trackConversion"]) => void}) {
  onReady(useMetaPixel().trackConversion);
  return null;
}

function renderProvider(
  onReady: (track: ReturnType<typeof useMetaPixel>["trackConversion"]) => void = () => undefined,
) {
  return render(
    <MetaPixelProvider enabled={state.enabled}>
      <TrackerCapture onReady={onReady} />
    </MetaPixelProvider>,
  );
}

function currentFbq() {
  return (window as Window & {fbq?: BrowserFbq}).fbq;
}

afterEach(() => {
  document.head.querySelectorAll('script[src*="connect.facebook.net"]').forEach((script) => script.remove());
  delete (window as Window & {fbq?: BrowserFbq}).fbq;
  delete (window as Window & {_fbq?: BrowserFbq})._fbq;
  Object.defineProperty(navigator, "globalPrivacyControl", {value: undefined, configurable: true});
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "3142520615938086");
  state.advertising = false;
  state.enabled = true;
  state.pathname = "/roof-estimate/example";
  state.authorizeAdvertising.mockReset().mockResolvedValue(true);
});

describe("PIW MetaPixelProvider", () => {
  test("does not load or touch Meta while advertising is denied", () => {
    renderProvider();

    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(currentFbq()).toBeUndefined();
  });

  test("treats browser Global Privacy Control as authoritative even if an upstream context is stale", async () => {
    state.advertising = true;
    Object.defineProperty(navigator, "globalPrivacyControl", {value: true, configurable: true});
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    renderProvider((track) => {
      trackConversion = track;
    });
    await waitFor(() => expect(trackConversion).toBeDefined());

    trackConversion?.({
      name: "Lead",
      eventId: "12111111-1111-4111-8111-111111111111",
      issuedAt: new Date().toISOString(),
    });

    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(currentFbq()).toBeUndefined();
  });

  test("does not load Meta outside the public roof estimate route", () => {
    state.advertising = true;
    state.pathname = "/app/leads";
    renderProvider();

    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(currentFbq()).toBeUndefined();
  });

  test("does not load Meta when the public pixel ID is unavailable", () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    state.advertising = true;
    renderProvider();

    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(currentFbq()).toBeUndefined();
  });

  test("does not load or convert when tracking is disabled with a configured pixel ID", async () => {
    state.advertising = true;
    state.enabled = false;
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    renderProvider((track) => {
      trackConversion = track;
    });
    await waitFor(() => expect(trackConversion).toBeDefined());

    trackConversion?.({
      name: "Lead",
      eventId: "10111111-1111-4111-8111-111111111111",
      issuedAt: new Date().toISOString(),
    });

    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    expect(currentFbq()).toBeUndefined();
  });

  test("grant loads once and tracks the current PageView once", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    const {rerender} = renderProvider();

    await waitFor(() => expect(document.querySelectorAll('script[src*="connect.facebook.net"]')).toHaveLength(1));
    rerender(
      <MetaPixelProvider enabled={state.enabled}>
        <TrackerCapture onReady={() => undefined} />
      </MetaPixelProvider>,
    );

    expect(fbq).toHaveBeenCalledWith("track", "PageView");
    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1);
  });

  test("tracks a server envelope once with eventID", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    renderProvider((track) => {
      trackConversion = track;
    });
    await waitFor(() => expect(trackConversion).toBeDefined());
    const envelope = {
      name: "Lead" as const,
      eventId: "11111111-1111-4111-8111-111111111111",
      issuedAt: new Date().toISOString(),
    };

    trackConversion?.(envelope);
    trackConversion?.(envelope);

    await waitFor(() => expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: envelope.eventId}));
    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(1);
  });

  test("uses the current consent when an earlier async callback resolves", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let staleTrack: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    const {rerender} = renderProvider((track) => {
      staleTrack = track;
    });
    await waitFor(() => expect(staleTrack).toBeDefined());
    let resolveRequest: (() => void) | undefined;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }).then(() => staleTrack?.({
      name: "Lead",
      eventId: "22222222-2222-4222-8222-222222222222",
      issuedAt: new Date().toISOString(),
    }));
    state.advertising = false;
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);
    resolveRequest?.();
    await request;

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
  });

  test("uses the current PIW route when an earlier callback resolves", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let staleTrack: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    const {rerender} = renderProvider((track) => {
      staleTrack = track;
    });
    await waitFor(() => expect(staleTrack).toBeDefined());
    state.pathname = "/leads";
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);

    staleTrack?.({
      name: "Lead",
      eventId: "33333333-3333-4333-8333-333333333333",
      issuedAt: new Date().toISOString(),
    });

    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(0);
  });

  test("tracks each return to a public assessment route", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    const {rerender} = renderProvider();
    await waitFor(() => expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1));
    state.pathname = "/roof-estimate/second";
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);
    await waitFor(() => expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(2));
    state.pathname = "/roof-estimate/example";
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);

    await waitFor(() => expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(3));
  });

  test("suppresses a mounted-tab PageView after canonical consent is revoked elsewhere", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    state.authorizeAdvertising.mockResolvedValueOnce(true).mockResolvedValue(false);
    const {rerender} = renderProvider();
    await waitFor(() => expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(state.authorizeAdvertising).toHaveBeenCalledTimes(2));
    state.pathname = "/roof-estimate/revoked";
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fbq.mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1);
  });

  test("suppresses navigation and conversion when canonical authorization changes during the request", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let resolveAuthorization: ((allowed: boolean) => void) | undefined;
    state.authorizeAdvertising.mockImplementation(() => new Promise<boolean>((resolve) => {
      resolveAuthorization = resolve;
    }));
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    const {rerender} = renderProvider((track) => { trackConversion = track; });
    trackConversion?.({
      name: "Lead",
      eventId: "77777777-7777-4777-8777-777777777777",
      issuedAt: new Date().toISOString(),
    });
    state.pathname = "/roof-estimate/new-path";
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);
    state.advertising = false;
    rerender(<MetaPixelProvider enabled={state.enabled}><TrackerCapture onReady={() => undefined} /></MetaPixelProvider>);
    resolveAuthorization?.(true);

    await waitFor(() => expect(state.authorizeAdvertising).toHaveBeenCalled());
    expect(fbq.mock.calls.filter((call) => ["PageView", "Lead"].includes(String(call[1])))).toHaveLength(0);
  });

  test("rejects malformed envelopes and tracks AssessmentCompleted without payload data", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    let trackConversion: ReturnType<typeof useMetaPixel>["trackConversion"] | undefined;
    renderProvider((track) => {
      trackConversion = track;
    });
    await waitFor(() => expect(trackConversion).toBeDefined());
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
    await waitFor(() => expect(fbq).toHaveBeenCalledWith(
      "trackCustom",
      "AssessmentCompleted",
      {},
      {eventID: "66666666-6666-4666-8666-666666666666"},
    ));
  });
});
