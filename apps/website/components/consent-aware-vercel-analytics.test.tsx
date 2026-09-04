// @vitest-environment jsdom

import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({analytics: false}));

vi.mock("./privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({preferences: {analytics: state.analytics}}),
}));
vi.mock("@vercel/analytics/next", () => ({
  Analytics: ({beforeSend}: {beforeSend: (event: {type: "pageview"; url: string}) => unknown}) => (
    <output
      data-testid="vercel-analytics"
      data-consent={beforeSend({type: "pageview", url: "/"}) ? "allowed" : "blocked"}
    />
  ),
}));

import {ConsentAwareVercelAnalytics} from "./consent-aware-vercel-analytics";

beforeEach(() => {
  state.analytics = false;
  document.body.replaceChildren();
  window.va = vi.fn();
});

afterEach(() => {
  delete window.va;
});

describe("ConsentAwareVercelAnalytics", () => {
  test("does not mount analytics before consent", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ConsentAwareVercelAnalytics />));

    expect(container.querySelector('[data-testid="vercel-analytics"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("mounts analytics after analytics consent", async () => {
    state.analytics = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ConsentAwareVercelAnalytics />));

    expect(container.querySelector('[data-testid="vercel-analytics"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("blocks later events after consent is revoked", async () => {
    state.analytics = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ConsentAwareVercelAnalytics />));
    expect(container.querySelector('[data-consent="allowed"]')).not.toBeNull();

    state.analytics = false;
    await act(async () => root.render(<ConsentAwareVercelAnalytics />));

    expect(container.querySelector('[data-testid="vercel-analytics"]')).toBeNull();
    expect(window.va).toHaveBeenCalledWith("beforeSend", expect.any(Function));
    const blocker = vi.mocked(window.va!).mock.calls.at(-1)?.[1] as
      | ((event: unknown) => unknown)
      | undefined;
    expect(blocker).toBeTypeOf("function");
    expect(blocker?.({type: "pageview", url: "/after-revocation"})).toBeNull();
    await act(async () => root.unmount());
  });
});
