import {NextRequest} from "next/server";
import {describe, expect, test} from "vitest";
import proxy from "./proxy";

describe("public static page proxy", () => {
  test("rewrites HTML pages through the consent runtime shell", () => {
    const response = proxy(new NextRequest("https://allseason.example/service-areas/atlantic-county.html"));

    expect(response.headers.get("x-middleware-rewrite"))
      .toBe("https://allseason.example/public-pages/service-areas/atlantic-county.html");
  });

  test("leaves App Router campaign routes on their single React provider", () => {
    const response = proxy(new NextRequest("https://allseason.example/campaigns/seasonal-shield"));

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("ad attribution cookie", () => {
  const SECRET = "s".repeat(32);

  test("sets a signed, HttpOnly, registrable-domain cookie on a paid landing", async () => {
    const {vi} = await import("vitest");
    vi.stubEnv("AD_ATTRIBUTION_SIGNING_SECRET", SECRET);
    try {
      const response = proxy(new NextRequest(
        "https://allseasonroofingquote.com/roof-replacement?gclid=Cj0_test&utm_source=google&utm_medium=cpc",
      ));
      const cookie = response.cookies.get("as_attr");
      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const header = response.headers.get("set-cookie") ?? "";
      expect(header).toContain("Domain=allseasonroofingquote.com");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
      expect(header.toLowerCase()).toContain("samesite=lax");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("leaves the cookie alone on plain navigation and without a secret", async () => {
    const {vi} = await import("vitest");
    vi.stubEnv("AD_ATTRIBUTION_SIGNING_SECRET", SECRET);
    try {
      expect(proxy(new NextRequest("https://allseasonroofingquote.com/roof-replacement")).cookies.get("as_attr")).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(proxy(new NextRequest("https://allseasonroofingquote.com/?gclid=x")).cookies.get("as_attr")).toBeUndefined();
  });

  test("never sets the cookie on API or asset requests", async () => {
    const {vi} = await import("vitest");
    vi.stubEnv("AD_ATTRIBUTION_SIGNING_SECRET", SECRET);
    try {
      expect(proxy(new NextRequest("https://allseasonroofingquote.com/api/property-preview?gclid=x")).cookies.get("as_attr")).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
