// @vitest-environment jsdom

import {render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({
  advertising: false,
  pathname: "/roof-estimate/example",
}));

vi.mock("@/components/privacy/privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({preferences: {advertising: state.advertising}}),
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
    <MetaPixelProvider>
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
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "3142520615938086");
  state.advertising = false;
  state.pathname = "/roof-estimate/example";
});

describe("PIW MetaPixelProvider", () => {
  test("does not load or touch Meta while advertising is denied", () => {
    renderProvider();

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

  test("grant loads once and tracks the current PageView once", async () => {
    state.advertising = true;
    const fbq = vi.fn();
    (window as Window & {fbq?: BrowserFbq}).fbq = fbq;
    const {rerender} = renderProvider();

    await waitFor(() => expect(document.querySelectorAll('script[src*="connect.facebook.net"]')).toHaveLength(1));
    rerender(
      <MetaPixelProvider>
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

    expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: envelope.eventId});
    expect(fbq.mock.calls.filter((call) => call[1] === "Lead")).toHaveLength(1);
  });
});
