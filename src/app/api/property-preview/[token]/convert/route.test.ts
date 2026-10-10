import { NextRequest, NextResponse } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handlePreviewConversionRequest } from "./route";

const token = "t".repeat(43);
const companyId = "11111111-1111-4111-8111-111111111111";
const contact = {
  submission_id: "55555555-5555-4555-8555-555555555555",
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
};
const preview = {
  submitted_address: "1 Main St, Newark, NJ 07102",
  canonical_address: "1 Main St, Newark, NJ 07102, USA",
  google_place_id: "ChIJ-one",
  campaign: null,
  entry_point: "main-home",
  presentation_key: "all-season-main",
  attribution: {},
  referrer: null,
  status: "active",
  expires_at: "2099-01-01T00:00:00.000Z",
};

function request(body: unknown, cookies = "") {
  return new NextRequest(`https://estimate.allseasonroofingquote.com/api/property-preview/${token}/convert`, {
    method: "POST",
    headers: {
      host: "estimate.allseasonroofingquote.com",
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5, 10.0.0.1",
      "user-agent": "Mozilla/5.0",
      ...(cookies ? {cookie: cookies} : {}),
    },
    body: JSON.stringify(body),
  });
}

function deps(overrides = {}) {
  return {
    companyId,
    resolveCompany: vi.fn(async () => companyId),
    loadPreview: vi.fn(async () => preview),
    advertisingAllowed: vi.fn(async () => false),
    process: vi.fn(async () => NextResponse.json({accepted: true, continuationPath: "/roof-estimate/continue/abc", metaEvent: null}, {status: 202})),
    finalize: vi.fn(async () => undefined),
    now: () => new Date("2026-10-03T12:05:00.000Z"),
    ...overrides,
  };
}

describe("POST /api/property-preview/[token]/convert", () => {
  test("runs the canonical intake with server-held preview data and finalizes the preview", async () => {
    const d = deps();
    const response = await handlePreviewConversionRequest(request(contact, "_fbp=fb.1.1.1"), token, d);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({accepted: true, continuationPath: "/roof-estimate/continue/abc", metaEvent: null});
    const [input] = d.process.mock.calls[0] as unknown as [{address: string; client_ip_address: string; attribution: {fbp: string | null}; disclosure_version: string}];
    expect(input.address).toBe("1 Main St, Newark, NJ 07102, USA");
    expect(input.client_ip_address).toBe("203.0.113.5");
    expect(input.disclosure_version).toBe("all-season-campaign-estimate-v5");
    expect(input.attribution.fbp).toBeNull();
  });

  test("passes advertising cookies only with verified advertising consent", async () => {
    const d = deps({advertisingAllowed: vi.fn(async () => true)});
    await handlePreviewConversionRequest(request(contact, "_fbp=fb.1.1.1; _fbc=fb.1.2.abc"), token, d);
    const [input] = d.process.mock.calls[0] as unknown as [{attribution: {fbp: string | null; fbc: string | null}}];
    expect(input.attribution).toMatchObject({fbp: "fb.1.1.1", fbc: "fb.1.2.abc"});
  });

  test("finalizes only after the intake accepted the lead", async () => {
    const d = deps();
    await handlePreviewConversionRequest(request(contact), token, d);
    expect(d.finalize).toHaveBeenCalledWith({companyId, tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), submissionId: contact.submission_id});

    const rejected = deps({process: vi.fn(async () => NextResponse.json({error: "x"}, {status: 409}))});
    const response = await handlePreviewConversionRequest(request(contact), token, rejected);
    expect(response.status).toBe(409);
    expect(rejected.finalize).not.toHaveBeenCalled();
  });

  test("keeps the accepted lead's continuation when finalizing fails", async () => {
    const d = deps({finalize: vi.fn(async () => { throw new Error("db"); })});
    const response = await handlePreviewConversionRequest(request(contact), token, d);
    expect(response.status).toBe(202);
  });

  test("rejects invalid contact details without touching the intake", async () => {
    const d = deps();
    const response = await handlePreviewConversionRequest(request({...contact, address: "spoofed"}), token, d);
    expect(response.status).toBe(400);
    expect(d.process).not.toHaveBeenCalled();
  });

  test.each([
    ["an unknown host", {resolveCompany: vi.fn(async () => null)}],
    ["another tenant's host", {resolveCompany: vi.fn(async () => "99999999-9999-4999-8999-999999999999")}],
    ["an unknown preview", {loadPreview: vi.fn(async () => null)}],
    ["an expired preview", {loadPreview: vi.fn(async () => ({...preview, expires_at: "2026-10-01T00:00:00.000Z"}))}],
    ["a converted preview", {loadPreview: vi.fn(async () => ({...preview, status: "converted"}))}],
  ])("returns 404 for %s", async (_label, overrides) => {
    const d = deps(overrides);
    const response = await handlePreviewConversionRequest(request(contact), token, d);
    expect(response.status).toBe(404);
    expect(d.process).not.toHaveBeenCalled();
  });
});
