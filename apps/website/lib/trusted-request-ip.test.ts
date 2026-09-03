import {describe, expect, test} from "vitest";
import {trustedWebsiteRequestIp} from "./trusted-request-ip";

describe("trusted website request IP", () => {
  test("accepts Vercel's protected forwarding pair in production", () => {
    expect(trustedWebsiteRequestIp(new Headers({
      "x-vercel-id": "iad1::test",
      "x-vercel-forwarded-for": "203.0.113.7",
    }), "production")).toBe("203.0.113.7");
  });

  test("does not trust ordinary browser-controlled forwarding headers in production", () => {
    expect(trustedWebsiteRequestIp(new Headers({"x-forwarded-for": "203.0.113.7"}), "production"))
      .toBeNull();
  });

  test("accepts a local development forwarding header only outside production", () => {
    expect(trustedWebsiteRequestIp(new Headers({"x-forwarded-for": "203.0.113.7, 10.0.0.1"}), "test"))
      .toBe("203.0.113.7");
  });
});
