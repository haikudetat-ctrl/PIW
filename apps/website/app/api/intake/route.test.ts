import {NextRequest} from "next/server";
import {describe, expect, test, vi} from "vitest";
import {handleIntakeRequest} from "./route";

function request(body: unknown, cookie = "_fbp=fb.1.100.200; _fbc=fb.1.100.click") {
  return new NextRequest("https://rake.example/api/intake", {
    method: "POST",
    headers: {"content-type": "application/json", cookie},
    body: JSON.stringify(body),
  });
}

describe("lead intake proxy", () => {
  test("captures Meta attribution and forwards a normalized lead", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(
      request({
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        fbclid: "click-123",
      }),
      forward,
    );

    expect(response.status).toBe(202);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      source: "rake-website",
      attribution: {fbclid: "click-123", fbp: "fb.1.100.200", fbc: "fb.1.100.click"},
    }));
  });

  test("rejects invalid submissions without calling the webhook", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({name: ""}), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("returns a retryable gateway error when intake fails", async () => {
    const response = await handleIntakeRequest(
      request({
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
      }),
      async () => new Response(null, {status: 500}),
    );

    expect(response.status).toBe(502);
  });
});
