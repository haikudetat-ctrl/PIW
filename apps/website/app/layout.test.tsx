import {isValidElement, type ReactNode} from "react";
import {describe, expect, test, vi} from "vitest";

const mocks = vi.hoisted(() => ({
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

const {default: RootLayout} = await import("./layout");

describe("RootLayout", () => {
  test("mounts Vercel Analytics for every Rake website page", async () => {
    const layout = await RootLayout({children: <main>Rake</main>});

    function containsAnalytics(node: ReactNode): boolean {
      if (!isValidElement(node)) return false;
      if (node.type === mocks.ConsentAwareVercelAnalytics) return true;
      const props = node.props as {children?: ReactNode};
      const children = Array.isArray(props.children) ? props.children : [props.children];
      return children.some(containsAnalytics);
    }

    expect(containsAnalytics(layout)).toBe(true);
  });
});
