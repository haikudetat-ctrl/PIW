import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handleSaveReportRequest } from "./route";

const token = "t".repeat(43);
const request = (body: unknown) => new NextRequest(`https://estimate.allseasonroofingquote.com/api/property-preview/${token}/save-report`, {
  method: "POST",
  headers: {host: "estimate.allseasonroofingquote.com", "content-type": "application/json"},
  body: JSON.stringify(body),
});

function deps(overrides = {}) {
  return {
    resolveCompany: vi.fn(async () => "c"),
    save: vi.fn(async () => ({kind: "saved" as const, previewId: "22222222-2222-4222-8222-222222222222"})),
    requestReport: vi.fn(async () => undefined),
    now: () => new Date("2026-10-03T12:00:00.000Z"),
    ...overrides,
  };
}

describe("POST /api/property-preview/[token]/save-report", () => {
  test("saves the email with its notice version and queues the report", async () => {
    const d = deps();
    const response = await handleSaveReportRequest(request({email: "alex@example.com"}), token, d);
    expect(response.status).toBe(204);
    expect(d.save).toHaveBeenCalledWith({
      companyId: "c",
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      email: "alex@example.com",
      disclosureVersion: "all-season-preview-email-v1",
      acceptedAt: "2026-10-03T12:00:00.000Z",
    });
    expect(d.requestReport).toHaveBeenCalledWith({companyId: "c", previewId: "22222222-2222-4222-8222-222222222222"});
  });

  test("returns 429 without queueing when the daily limit is reached", async () => {
    const d = deps({save: vi.fn(async () => ({kind: "limited" as const}))});
    const response = await handleSaveReportRequest(request({email: "alex@example.com"}), token, d);
    expect(response.status).toBe(429);
    expect(d.requestReport).not.toHaveBeenCalled();
  });

  test("rejects an invalid email or extra fields", async () => {
    for (const body of [{email: "nope"}, {email: "alex@example.com", phone: "1"}]) {
      const d = deps();
      expect((await handleSaveReportRequest(request(body), token, d)).status).toBe(400);
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  test("returns 404 for an inactive preview or unknown host", async () => {
    expect((await handleSaveReportRequest(request({email: "alex@example.com"}), token, deps({
      save: vi.fn(async () => ({kind: "inactive" as const})),
    }))).status).toBe(404);
    expect((await handleSaveReportRequest(request({email: "alex@example.com"}), token, deps({
      resolveCompany: vi.fn(async () => null),
    }))).status).toBe(404);
  });
});
