// @vitest-environment jsdom

import {act} from "react";
import {createRoot} from "react-dom/client";
import {beforeEach, describe, expect, test, vi} from "vitest";

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <output data-testid="vercel-analytics" />,
}));

import {ConsentAwareVercelAnalytics} from "./consent-aware-vercel-analytics";

beforeEach(() => {
  document.body.replaceChildren();
});

async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<ConsentAwareVercelAnalytics />));
  return {container, root};
}

describe("ConsentAwareVercelAnalytics", () => {
  test("mounts cookieless aggregate analytics without waiting for a consent decision", async () => {
    const {container, root} = await render();

    expect(container.querySelector('[data-testid="vercel-analytics"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("does not read consent preferences at all", async () => {
    const usePrivacyConsent = vi.fn();
    vi.doMock("./privacy-consent-provider", () => ({usePrivacyConsent}));

    const {container, root} = await render();

    expect(container.querySelector('[data-testid="vercel-analytics"]')).not.toBeNull();
    expect(usePrivacyConsent).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
