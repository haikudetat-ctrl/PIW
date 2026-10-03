import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handlePreviewAnswersRequest } from "./route";

const token = "t".repeat(43);
const request = (body: unknown) => new NextRequest(`https://estimate.allseasonroofingquote.com/api/property-preview/${token}/answers`, {
  method: "POST",
  headers: {host: "estimate.allseasonroofingquote.com", "content-type": "application/json"},
  body: JSON.stringify(body),
});

describe("POST /api/property-preview/[token]/answers", () => {
  test("records the pre-contact answers for the preview", async () => {
    const record = vi.fn(async () => true);
    const response = await handlePreviewAnswersRequest(request({reason: "storm_damage"}), token, {
      resolveCompany: vi.fn(async () => "c"),
      record,
    });
    expect(response.status).toBe(204);
    expect(record).toHaveBeenCalledWith({companyId: "c", tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), responses: {reason: "storm_damage"}});
  });

  test.each([
    [{stories: "two"}],
    [{reason: "bogus"}],
    [{}],
  ])("rejects %o", async (body) => {
    const record = vi.fn(async () => true);
    const response = await handlePreviewAnswersRequest(request(body), token, {resolveCompany: vi.fn(async () => "c"), record});
    expect(response.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  test("returns 404 for an inactive preview or unknown host", async () => {
    expect((await handlePreviewAnswersRequest(request({timeline: "asap"}), token, {
      resolveCompany: vi.fn(async () => "c"), record: vi.fn(async () => false),
    })).status).toBe(404);
    expect((await handlePreviewAnswersRequest(request({timeline: "asap"}), token, {
      resolveCompany: vi.fn(async () => null), record: vi.fn(async () => true),
    })).status).toBe(404);
  });
});
