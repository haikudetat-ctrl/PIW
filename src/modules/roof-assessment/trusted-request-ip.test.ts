import {describe, expect, test} from "vitest";
import {trustedRequestIp} from "./trusted-request-ip";

describe("trusted request IP", () => {
  test("uses only Vercel's overwritten single-address pair in production", () => {
    expect(trustedRequestIp(new Headers({
      "x-vercel-id":"iad1::request",
      "x-vercel-forwarded-for":"203.0.113.8",
      "x-forwarded-for":"198.51.100.1",
    }),"production")).toBe("203.0.113.8");
    expect(trustedRequestIp(new Headers({"x-forwarded-for":"203.0.113.8"}),"production")).toBeNull();
    expect(trustedRequestIp(new Headers({"x-vercel-id":"iad1::request","x-vercel-forwarded-for":"203.0.113.8, 198.51.100.1"}),"production")).toBeNull();
  });

  test("uses the first forwarded address in non-production", () => {
    expect(trustedRequestIp(new Headers({"x-forwarded-for":"127.0.0.2, 127.0.0.3"}),"test")).toBe("127.0.0.2");
    expect(trustedRequestIp(new Headers({"x-real-ip":"not-an-ip"}),"preview")).toBeNull();
  });
});
