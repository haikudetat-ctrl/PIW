import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isPublicPath, middleware } from "./middleware";

describe("public authentication routes", () => {
  test.each([
    "/forgot-password",
    "/reset-password",
    "/auth/email-action",
    "/auth/confirm",
    "/auth/callback",
  ])("allows unauthenticated access to %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  test("keeps the operational dashboard protected", () => {
    expect(isPublicPath("/leads")).toBe(false);
  });
});

describe("public assessment media boundary", () => {
  test.each([
    "/campaigns/for-every-season/hero.webp",
    "/campaigns/weather-report/hero.webp",
    "/campaigns/seasonal-shield/hero.webp",
    "/brand/all-season-mark.svg",
  ])("allows anonymous access to %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  test.each([
    "/pipeline",
    "/campaign-admin",
    "/campaigns-private/roof.webp",
    "/campaigns/unapproved/hero.webp",
    "/brand/other-logo.svg",
  ])("does not broaden anonymous access to %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("tenant estimate hosts", () => {
  afterEach(() => vi.unstubAllEnvs());

  function request(host: string, pathname: string) {
    return new NextRequest(`https://${host}${pathname}`, {headers: {host}});
  }

  test.each(["/", "/login", "/leads", "/api/inngest", "/api/integrations/all-season/campaign-estimate"])(
    "returns 404 for %s on a tenant host",
    async (pathname) => {
      vi.stubEnv("PUBLIC_ESTIMATE_HOSTS", "estimate.allseasonroofingquote.com");
      const response = await middleware(request("estimate.allseasonroofingquote.com", pathname));
      expect(response.status).toBe(404);
    },
  );

  test.each(["/roof-estimate/p/abc", "/api/property-preview/abc", "/privacy"])(
    "serves %s on a tenant host without a staff session lookup",
    async (pathname) => {
      vi.stubEnv("PUBLIC_ESTIMATE_HOSTS", "estimate.allseasonroofingquote.com");
      const response = await middleware(request("Estimate.AllSeasonRoofingQuote.com:443", pathname));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  test("leaves the PIW host's API routes unchanged when tenant hosts are configured", async () => {
    vi.stubEnv("PUBLIC_ESTIMATE_HOSTS", "estimate.allseasonroofingquote.com");
    const response = await middleware(request("piw.example.com", "/api/inngest"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
