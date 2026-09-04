import {render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({analytics: false}));

vi.mock("@/components/privacy/privacy-consent-provider", () => ({
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
  window.va = vi.fn();
});

afterEach(() => {
  delete window.va;
});

describe("ConsentAwareVercelAnalytics", () => {
  test("does not mount analytics before consent", () => {
    render(<ConsentAwareVercelAnalytics />);
    expect(screen.queryByTestId("vercel-analytics")).not.toBeInTheDocument();
  });

  test("mounts analytics after analytics consent", () => {
    state.analytics = true;
    render(<ConsentAwareVercelAnalytics />);
    expect(screen.getByTestId("vercel-analytics")).toBeInTheDocument();
  });

  test("blocks later events after consent is revoked", () => {
    state.analytics = true;
    const {rerender} = render(<ConsentAwareVercelAnalytics />);
    expect(screen.getByTestId("vercel-analytics")).toHaveAttribute("data-consent", "allowed");

    state.analytics = false;
    rerender(<ConsentAwareVercelAnalytics />);

    expect(screen.queryByTestId("vercel-analytics")).not.toBeInTheDocument();
    expect(window.va).toHaveBeenCalledWith("beforeSend", expect.any(Function));
    const blocker = vi.mocked(window.va!).mock.calls.at(-1)?.[1] as
      | ((event: unknown) => unknown)
      | undefined;
    expect(blocker).toBeTypeOf("function");
    expect(blocker?.({type: "pageview", url: "/after-revocation"})).toBeNull();
  });
});
