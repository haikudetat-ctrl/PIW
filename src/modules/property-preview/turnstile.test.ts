import { describe, expect, test, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

function siteverify(body: unknown, status = 200) {
  return vi.fn(async () => Response.json(body, {status}));
}

const base = {
  secretKey: "turnstile-secret",
  expectedHostnames: ["estimate.allseasonroofingquote.com", "allseasonroofingquote.com"],
  expectedAction: "property_preview",
};

describe("verifyTurnstile", () => {
  test("passes a successful challenge for an expected hostname and action", async () => {
    const fetch = siteverify({success: true, hostname: "allseasonroofingquote.com", action: "property_preview"});
    await expect(verifyTurnstile({...base, token: "token", remoteIp: "203.0.113.5", fetch}))
      .resolves.toEqual({kind: "passed"});
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = init.body as URLSearchParams;
    expect(form.get("secret")).toBe("turnstile-secret");
    expect(form.get("response")).toBe("token");
    expect(form.get("remoteip")).toBe("203.0.113.5");
  });

  test.each([
    ["an unsuccessful challenge", {success: false, "error-codes": ["invalid-input-response"]}],
    ["an unexpected hostname", {success: true, hostname: "evil.example.com", action: "property_preview"}],
    ["an unexpected action", {success: true, hostname: "allseasonroofingquote.com", action: "login"}],
  ])("fails %s", async (_label, body) => {
    await expect(verifyTurnstile({...base, token: "token", remoteIp: null, fetch: siteverify(body)}))
      .resolves.toEqual({kind: "failed"});
  });

  test("fails without calling Cloudflare when the token is missing or oversized", async () => {
    const fetch = siteverify({success: true});
    await expect(verifyTurnstile({...base, token: "", remoteIp: null, fetch})).resolves.toEqual({kind: "failed"});
    await expect(verifyTurnstile({...base, token: "x".repeat(2049), remoteIp: null, fetch})).resolves.toEqual({kind: "failed"});
    expect(fetch).not.toHaveBeenCalled();
  });

  test("treats a Cloudflare outage as unavailable, never as a pass", async () => {
    await expect(verifyTurnstile({...base, token: "token", remoteIp: null, fetch: siteverify({}, 503)}))
      .resolves.toEqual({kind: "unavailable"});
    const failing = vi.fn(async () => { throw new Error("network"); });
    await expect(verifyTurnstile({...base, token: "token", remoteIp: null, fetch: failing}))
      .resolves.toEqual({kind: "unavailable"});
  });
});
