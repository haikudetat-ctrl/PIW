// @vitest-environment jsdom

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import type {GoogleAdsConfig} from "../lib/google-ads-tracking";

const state = vi.hoisted(() => ({
  advertising: false,
  pathname: "/campaigns/roof-replacement",
  authorizeAdvertising: vi.fn(async () => true),
}));

vi.mock("./privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({
    preferences: {advertising: state.advertising},
    authorizeAdvertising: state.authorizeAdvertising,
  }),
}));

vi.mock("next/navigation", () => ({usePathname: () => state.pathname}));

import {GoogleAdsProvider, useGoogleAds} from "./google-ads-provider";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean})
  .IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: GoogleAdsConfig = {tagId: "AW-123456789", leadConversionLabel: "estimateLabel"};
const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const SCRIPT = 'script[src*="googletagmanager.com/gtag/js"]';
const mountedRoots: Root[] = [];

type Track = ReturnType<typeof useGoogleAds>["trackEstimateConversion"];

function TrackerCapture({onReady}: {onReady: (track: Track) => void}) {
  onReady(useGoogleAds().trackEstimateConversion);
  return null;
}

async function renderProvider(config: GoogleAdsConfig | null = CONFIG) {
  let track: Track | undefined;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(
    <GoogleAdsProvider config={config}><TrackerCapture onReady={(value) => { track = value; }} /></GoogleAdsProvider>,
  ));
  return {track: track!};
}

function installGtag() {
  const gtag = vi.fn((...args: unknown[]) => {
    const options = args[2] as {event_callback?: () => void} | undefined;
    if (args[0] === "event") options?.event_callback?.();
  });
  window.gtag = gtag;
  return gtag;
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  document.head.querySelectorAll(SCRIPT).forEach((script) => script.remove());
  delete window.gtag;
  delete window.dataLayer;
  Object.defineProperty(navigator, "globalPrivacyControl", {value: undefined, configurable: true});
  vi.useRealTimers();
});

beforeEach(() => {
  state.advertising = false;
  state.pathname = "/campaigns/roof-replacement";
  state.authorizeAdvertising.mockReset().mockResolvedValue(true);
});

describe("website GoogleAdsProvider", () => {
  test("does not load or touch Google while advertising is denied", async () => {
    const {track} = await renderProvider();
    await act(async () => track(SUBMISSION_ID));

    expect(document.querySelector(SCRIPT)).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  test("does not load Google when tracking is not configured", async () => {
    state.advertising = true;
    const {track} = await renderProvider(null);
    await act(async () => track(SUBMISSION_ID));

    expect(document.querySelector(SCRIPT)).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  test("treats browser Global Privacy Control as authoritative", async () => {
    state.advertising = true;
    Object.defineProperty(navigator, "globalPrivacyControl", {value: true, configurable: true});
    const {track} = await renderProvider();
    await act(async () => track(SUBMISSION_ID));

    expect(document.querySelector(SCRIPT)).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  test("after authorized consent, loads the tag once with consent defaulted to denied then granted", async () => {
    state.advertising = true;
    await renderProvider();

    expect(document.querySelectorAll(SCRIPT)).toHaveLength(1);
    expect(document.querySelector(SCRIPT)?.getAttribute("src")).toContain("id=AW-123456789");
    const commands = (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands[0]).toEqual(["consent", "default", expect.objectContaining({ad_storage: "denied"})]);
    expect(commands).toContainEqual(["consent", "update", expect.objectContaining({ad_storage: "granted"})]);
    expect(commands).toContainEqual(["config", "AW-123456789"]);
  });

  test("does not load when the canonical consent check refuses advertising", async () => {
    state.advertising = true;
    state.authorizeAdvertising.mockResolvedValue(false);
    await renderProvider();

    expect(document.querySelector(SCRIPT)).toBeNull();
  });

  test("sends the estimate conversion once, keyed by submission ID", async () => {
    state.advertising = true;
    const gtag = installGtag();
    const {track} = await renderProvider();

    await act(async () => track(SUBMISSION_ID));
    await act(async () => track(SUBMISSION_ID));

    const conversions = gtag.mock.calls.filter((call) => call[0] === "event");
    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toEqual(["event", "conversion", expect.objectContaining({
      send_to: "AW-123456789/estimateLabel",
      transaction_id: SUBMISSION_ID,
    })]);
  });

  test("ignores a malformed submission ID", async () => {
    state.advertising = true;
    const gtag = installGtag();
    const {track} = await renderProvider();
    await act(async () => track("not-a-uuid"));

    expect(gtag.mock.calls.filter((call) => call[0] === "event")).toHaveLength(0);
  });

  test("never holds navigation longer than the wait cap", async () => {
    state.advertising = true;
    installGtag();
    const {track} = await renderProvider();
    vi.useFakeTimers();
    state.authorizeAdvertising.mockReturnValue(new Promise(() => undefined));

    let settled = false;
    void track("22222222-2222-4222-8222-222222222222").then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
