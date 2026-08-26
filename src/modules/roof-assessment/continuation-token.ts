import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const continuationPayloadSchema = z.strictObject({
  attemptId: z.uuid(),
  secret: z.string().regex(/^[a-f0-9]{64}$/i),
  expiresAt: z.iso.datetime({offset: true}),
});

export type ContinuationPayload = z.infer<typeof continuationPayloadSchema>;

const INVALID_CONTINUATION = "Invalid continuation";
const TOKEN_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

function validSigningKey(signingKey: string) {
  return Buffer.byteLength(signingKey, "utf8") >= 32;
}

function canonicalJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function encodePayload(payload: ContinuationPayload) {
  return Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
}

function signatureFor(encodedPayload: string, signingKey: string) {
  return createHmac("sha256", signingKey).update(encodedPayload, "ascii").digest();
}

function invalidContinuation(): never {
  throw new Error(INVALID_CONTINUATION);
}

export async function signContinuation(
  input: ContinuationPayload,
  signingKey: string,
): Promise<string> {
  try {
    if (!validSigningKey(signingKey)) invalidContinuation();
    const payload = continuationPayloadSchema.parse(input);
    const encodedPayload = encodePayload(payload);
    const signature = signatureFor(encodedPayload, signingKey).toString("base64url");
    return `${encodedPayload}.${signature}`;
  } catch {
    return invalidContinuation();
  }
}

export async function verifyContinuation(
  token: string,
  signingKey: string,
  now: Date = new Date(),
): Promise<ContinuationPayload> {
  try {
    if (!validSigningKey(signingKey) || !Number.isFinite(now.getTime())) {
      invalidContinuation();
    }

    const match = TOKEN_PATTERN.exec(token);
    if (!match) invalidContinuation();
    const [, encodedPayload, encodedSignature] = match;
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = signatureFor(encodedPayload, signingKey);
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      invalidContinuation();
    }

    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const payload = continuationPayloadSchema.parse(decoded);
    if (encodePayload(payload) !== encodedPayload) invalidContinuation();
    if (Date.parse(payload.expiresAt) <= now.getTime()) invalidContinuation();
    return payload;
  } catch {
    return invalidContinuation();
  }
}
