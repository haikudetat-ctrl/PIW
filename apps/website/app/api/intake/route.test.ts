import {NextRequest} from "next/server";
import {afterEach, describe, expect, test, vi} from "vitest";
import {handleIntakeRequest, POST} from "./route";

afterEach(() => {
  delete process.env.INTAKE_WEBHOOK_URL;
  delete process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  vi.unstubAllGlobals();
});

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
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        google_place_id: "ChIJ-selected",
        project_interest: "both",
        consent_to_contact: true,
        consent_to_process_property: true,
        fbclid: "click-123",
      }),
      forward,
    );

    expect(response.status).toBe(202);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      submission_id: "11111111-1111-4111-8111-111111111111",
      source: "all-season-website",
      google_place_id: "ChIJ-selected",
      attribution: {fbclid: "click-123", fbp: "fb.1.100.200", fbc: "fb.1.100.click"},
    }));
  });

  test("rejects invalid submissions without calling the webhook", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({name: ""}), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("requires explicit contact consent", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
      project_interest: "roofing",
      consent_to_contact: false,
      consent_to_process_property: true,
    }), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("requires explicit property-processing consent", async () => {
    const forward = vi.fn(async () => new Response(null, {status: 200}));
    const response = await handleIntakeRequest(request({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
      project_interest: "solar",
      consent_to_contact: true,
      consent_to_process_property: false,
    }), forward);

    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("returns a retryable gateway error when intake fails", async () => {
    const response = await handleIntakeRequest(
      request({
        submission_id: "11111111-1111-4111-8111-111111111111",
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "201-555-0100",
        address: "1 Main St, Newark, NJ",
        project_interest: "roofing",
        consent_to_contact: true,
        consent_to_process_property: true,
      }),
      async () => new Response(null, {status: 500}),
    );

    expect(response.status).toBe(502);
  });

  test("authenticates the server-to-server request with the All Season header", async () => {
    process.env.INTAKE_WEBHOOK_URL = "https://piw.example/api/integrations/all-season/intake";
    process.env.INTAKE_WEBHOOK_SHARED_SECRET = "shared-secret";
    const fetch = vi.fn(async () => new Response(null, {status: 202}));
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request({
      submission_id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "1 Main St, Newark, NJ",
      project_interest: "both",
      consent_to_contact: true,
      consent_to_process_property: true,
    }));

    expect(response.status).toBe(202);
    expect(fetch).toHaveBeenCalledWith(
      "https://piw.example/api/integrations/all-season/intake",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-all-season-intake-secret": "shared-secret",
        }),
      }),
    );
  });
});
