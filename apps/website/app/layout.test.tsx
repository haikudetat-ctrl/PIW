import {isValidElement, type ReactNode} from "react";
import {describe, expect, test, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  ConsentAwarePostHog: () => null,
  ConsentAwareVercelAnalytics: () => null,
  cookies: vi.fn(async () => ({get: () => undefined})),
}));

vi.mock("next/headers", () => ({cookies: mocks.cookies}));
vi.mock("../components/privacy-consent-provider", () => ({
  PrivacyConsentProvider: ({children}: {children: ReactNode}) => children,
}));
vi.mock("../components/meta-pixel-provider", () => ({
  MetaPixelProvider: ({children}: {children: ReactNode}) => children,
}));
vi.mock("../components/consent-aware-vercel-analytics", () => ({
  ConsentAwareVercelAnalytics: mocks.ConsentAwareVercelAnalytics,
}));
vi.mock("../components/consent-aware-posthog", () => ({
  ConsentAwarePostHog: mocks.ConsentAwarePostHog,
}));

const {default: RootLayout} = await import("./layout");

describe("RootLayout", () => {
  test("mounts consent-aware analytics for every Rake website page", async () => {
    const layout = await RootLayout({children: <main>Rake</main>});

    function contains(node: ReactNode, type: unknown): boolean {
      if (!isValidElement(node)) return false;
      if (node.type === type) return true;
      const props = node.props as {children?: ReactNode};
      const children = Array.isArray(props.children) ? props.children : [props.children];
      return children.some((child) => contains(child, type));
    }

    expect(contains(layout, mocks.ConsentAwareVercelAnalytics)).toBe(true);
    expect(contains(layout, mocks.ConsentAwarePostHog)).toBe(true);
  });
});
