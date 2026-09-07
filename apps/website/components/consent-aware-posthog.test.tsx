// @vitest-environment jsdom

import {act} from "react";
import {createRoot} from "react-dom/client";
import {beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({analytics: false}));

vi.mock("./privacy-consent-provider", () => ({
  usePrivacyConsent: () => ({preferences: {analytics: state.analytics}}),
}));

import {ConsentAwarePostHog} from "./consent-aware-posthog";

beforeEach(() => {
  state.analytics = false;
  document.body.replaceChildren();
});

describe("ConsentAwarePostHog", () => {
  test("publishes the current Analytics consent state and later revocations", async () => {
    const values: boolean[] = [];
    window.addEventListener("allseason:privacy-consent", ((event: CustomEvent) => {
      values.push(event.detail.analytics);
    }) as EventListener);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<ConsentAwarePostHog />));
    state.analytics = true;
    await act(async () => root.render(<ConsentAwarePostHog />));
    state.analytics = false;
    await act(async () => root.render(<ConsentAwarePostHog />));

    expect(values).toEqual([false, true, false]);
    await act(async () => root.unmount());
  });
});
