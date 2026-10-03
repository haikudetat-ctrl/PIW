import { describe, expect, test } from "vitest";
import { hashPreviewToken, issuePreviewToken, isPreviewTokenShape } from "./preview-token";

describe("preview tokens", () => {
  test("issues a 256-bit base64url token with its SHA-256 hash", () => {
    const issued = issuePreviewToken();
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPreviewToken(issued.token)).toBe(issued.tokenHash);
  });

  test("never issues the same token twice", () => {
    const tokens = new Set(Array.from({length: 50}, () => issuePreviewToken().token));
    expect(tokens.size).toBe(50);
  });

  test("recognizes only well-formed tokens", () => {
    expect(isPreviewTokenShape(issuePreviewToken().token)).toBe(true);
    expect(isPreviewTokenShape("short")).toBe(false);
    expect(isPreviewTokenShape("a".repeat(42) + "!")).toBe(false);
    expect(isPreviewTokenShape(undefined)).toBe(false);
  });
});
