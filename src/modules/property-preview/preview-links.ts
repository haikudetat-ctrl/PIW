import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Links placed in preview report emails. They carry the preview ID plus an
// HMAC bound to the link's purpose, never the preview's URL capability, so an
// email (or an event payload) can't be replayed as a different action.

export type PreviewLinkPurpose = "resume" | "unsubscribe";

function signature(purpose: PreviewLinkPurpose, previewId: string, secret: string) {
  return createHmac("sha256", secret).update(`property-preview:${purpose}:${previewId}`, "utf8").digest("base64url");
}

export function signPreviewLink(purpose: PreviewLinkPurpose, previewId: string, secret: string) {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("Preview link secret is too short");
  return `${z.uuid().parse(previewId)}.${signature(purpose, previewId, secret)}`;
}

export function verifyPreviewLink(purpose: PreviewLinkPurpose, value: string, secret: string): string | null {
  const [previewId, provided, extra] = value.split(".");
  if (extra !== undefined || !z.uuid().safeParse(previewId).success || !provided) return null;
  const expected = Buffer.from(signature(purpose, previewId, secret));
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? previewId : null;
}
