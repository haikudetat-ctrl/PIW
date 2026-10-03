import { describe, expect, test, vi } from "vitest";
import { resumePreviewFromEmail, unsubscribePreviewEmail } from "./email-link-handlers";

const companyId = "11111111-1111-4111-8111-111111111111";
const previewId = "22222222-2222-4222-8222-222222222222";

describe("resumePreviewFromEmail", () => {
  test("rotates the preview capability and returns the new preview path", async () => {
    const rotate = vi.fn(async () => true);
    const result = await resumePreviewFromEmail({link: "signed", companyId}, {
      verify: () => previewId,
      issueToken: () => ({token: "n".repeat(43), tokenHash: "b".repeat(64)}),
      rotate,
    });
    expect(result).toBe(`/roof-estimate/p/${"n".repeat(43)}`);
    expect(rotate).toHaveBeenCalledWith({companyId, previewId, tokenHash: "b".repeat(64)});
  });

  test("starts over for a bad signature or an inactive preview", async () => {
    expect(await resumePreviewFromEmail({link: "bad", companyId}, {
      verify: () => null, issueToken: vi.fn(), rotate: vi.fn(),
    })).toBe("/roof-estimate");
    expect(await resumePreviewFromEmail({link: "signed", companyId}, {
      verify: () => previewId, issueToken: () => ({token: "n".repeat(43), tokenHash: "b".repeat(64)}), rotate: vi.fn(async () => false),
    })).toBe("/roof-estimate");
  });
});

describe("unsubscribePreviewEmail", () => {
  test("marks the preview unsubscribed and suppresses the address for the company", async () => {
    const unsubscribe = vi.fn(async () => true);
    await expect(unsubscribePreviewEmail({link: "signed", companyId}, {verify: () => previewId, unsubscribe}))
      .resolves.toBe(true);
    expect(unsubscribe).toHaveBeenCalledWith({companyId, previewId});
  });

  test("does nothing for a bad signature", async () => {
    const unsubscribe = vi.fn(async () => true);
    await expect(unsubscribePreviewEmail({link: "bad", companyId}, {verify: () => null, unsubscribe})).resolves.toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
