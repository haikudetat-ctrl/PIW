import { describe, expect, test } from "vitest";
import { signPreviewLink, verifyPreviewLink } from "./preview-links";

const secret = "s".repeat(32);
const previewId = "22222222-2222-4222-8222-222222222222";

describe("signed preview links", () => {
  test("round-trips a preview ID for its purpose", () => {
    const link = signPreviewLink("resume", previewId, secret);
    expect(link).toMatch(/^22222222-2222-4222-8222-222222222222\.[A-Za-z0-9_-]{43}$/);
    expect(verifyPreviewLink("resume", link, secret)).toBe(previewId);
  });

  test("rejects a link signed for another purpose, secret, or a tampered ID", () => {
    const link = signPreviewLink("resume", previewId, secret);
    expect(verifyPreviewLink("unsubscribe", link, secret)).toBeNull();
    expect(verifyPreviewLink("resume", link, "x".repeat(32))).toBeNull();
    expect(verifyPreviewLink("resume", link.replace("2222-4222", "3333-4333"), secret)).toBeNull();
    expect(verifyPreviewLink("resume", "garbage", secret)).toBeNull();
  });

  test("refuses to sign with a short secret", () => {
    expect(() => signPreviewLink("resume", previewId, "short")).toThrow();
  });
});
