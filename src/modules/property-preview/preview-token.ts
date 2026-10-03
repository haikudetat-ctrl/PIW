import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Preview URLs carry a 256-bit random capability. Only its SHA-256 hash is
// stored, so a database read never yields a usable link.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashPreviewToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function issuePreviewToken() {
  const token = randomBytes(32).toString("base64url");
  return {token, tokenHash: hashPreviewToken(token)};
}

export function isPreviewTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
