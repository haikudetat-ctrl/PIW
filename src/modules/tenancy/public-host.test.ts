import { describe, expect, test, vi } from "vitest";
import {
  isTenantPublicPath,
  normalizeHost,
  parseTenantHosts,
  resolvePublicHost,
  type PublicHostLookup,
} from "./public-host";

describe("normalizeHost", () => {
  test("lowercases and strips the port", () => {
    expect(normalizeHost("Estimate.AllSeasonRoofingQuote.com:443")).toBe("estimate.allseasonroofingquote.com");
  });

  test("rejects empty or malformed hosts", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("bad host/with/path")).toBeNull();
  });
});

describe("parseTenantHosts", () => {
  test("parses a comma-separated allowlist", () => {
    expect(parseTenantHosts(" estimate.allseasonroofingquote.com, Quote.Example.com ,,"))
      .toEqual(new Set(["estimate.allseasonroofingquote.com", "quote.example.com"]));
  });

  test("is empty when unset", () => {
    expect(parseTenantHosts(undefined).size).toBe(0);
  });
});

describe("isTenantPublicPath", () => {
  test.each([
    "/roof-estimate",
    "/roof-estimate/p/abc",
    "/roof-estimate/continue/abc",
    "/api/property-preview",
    "/api/property-preview/abc/convert",
    "/api/roof-estimate/abc/house-image",
    "/privacy",
    "/campaigns/for-every-season/hero.webp",
  ])("serves %s on a tenant host", (pathname) => {
    expect(isTenantPublicPath(pathname)).toBe(true);
  });

  test.each([
    "/",
    "/login",
    "/leads",
    "/settings",
    "/auth/callback",
    "/api/inngest",
    "/api/integrations/all-season/campaign-estimate",
    "/roof-estimate-admin",
    "/api/property-previews",
  ])("hides %s on a tenant host", (pathname) => {
    expect(isTenantPublicPath(pathname)).toBe(false);
  });
});

describe("resolvePublicHost", () => {
  function lookup(row: unknown): PublicHostLookup {
    return vi.fn(async () => row) as unknown as PublicHostLookup;
  }

  test("returns the company and a validated brand for a verified host", async () => {
    const find = lookup({
      company_id: "11111111-1111-4111-8111-111111111111",
      verified_at: "2026-10-03T00:00:00Z",
      brand: {
        displayName: "All Season Solar",
        logoUrl: "https://allseasonroofingquote.com/assets/all-season-logo-color.svg",
        privacyUrl: "https://allseasonroofingquote.com/privacy.html",
        termsUrl: "https://allseasonroofingquote.com/terms.html",
        accentColor: "#1a5fb4",
      },
    });

    await expect(resolvePublicHost("Estimate.AllSeasonRoofingQuote.com", find)).resolves.toEqual({
      companyId: "11111111-1111-4111-8111-111111111111",
      host: "estimate.allseasonroofingquote.com",
      brand: {
        displayName: "All Season Solar",
        logoUrl: "https://allseasonroofingquote.com/assets/all-season-logo-color.svg",
        privacyUrl: "https://allseasonroofingquote.com/privacy.html",
        termsUrl: "https://allseasonroofingquote.com/terms.html",
        accentColor: "#1a5fb4",
      },
    });
    expect(find).toHaveBeenCalledWith("estimate.allseasonroofingquote.com");
  });

  test("ignores unverified hosts", async () => {
    await expect(resolvePublicHost("estimate.example.com", lookup({
      company_id: "11111111-1111-4111-8111-111111111111",
      verified_at: null,
      brand: {displayName: "Example", privacyUrl: "https://example.com/privacy"},
    }))).resolves.toBeNull();
  });

  test("returns null for unknown hosts or an invalid brand", async () => {
    await expect(resolvePublicHost("unknown.example.com", lookup(null))).resolves.toBeNull();
    await expect(resolvePublicHost("estimate.example.com", lookup({
      company_id: "11111111-1111-4111-8111-111111111111",
      verified_at: "2026-10-03T00:00:00Z",
      brand: {displayName: "Example", privacyUrl: "javascript:alert(1)"},
    }))).resolves.toBeNull();
  });
});
