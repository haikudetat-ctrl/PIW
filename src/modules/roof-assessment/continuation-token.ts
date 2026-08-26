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
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const continuationEnvelopeSchema = z.strictObject({
  payload: z.string().min(1),
  signature: z.string().regex(SIGNATURE_PATTERN),
});

function validSigningKey(signingKey: string) {
  return Buffer.byteLength(signingKey, "utf8") >= 32;
}

function canonicalJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function canonicalPayload(payload: ContinuationPayload) {
  return canonicalJson(payload);
}

function signatureFor(payload: string, signingKey: string) {
  return createHmac("sha256", signingKey).update(payload, "utf8").digest();
}

function encodeEnvelope(payload: string, signature: string) {
  return Buffer.from(JSON.stringify({payload, signature}), "utf8").toString("base64url");
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
    const serializedPayload = canonicalPayload(payload);
    const signature = signatureFor(serializedPayload, signingKey).toString("base64url");
    return encodeEnvelope(serializedPayload, signature);
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

    if (!TOKEN_PATTERN.test(token)) invalidContinuation();
    const decodedEnvelope = Buffer.from(token, "base64url").toString("utf8");
    const envelope = continuationEnvelopeSchema.parse(JSON.parse(decodedEnvelope));
    if (encodeEnvelope(envelope.payload, envelope.signature) !== token) invalidContinuation();

    const suppliedSignature = Buffer.from(envelope.signature, "base64url");
    const expectedSignature = signatureFor(envelope.payload, signingKey);
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      invalidContinuation();
    }

    const payload = continuationPayloadSchema.parse(JSON.parse(envelope.payload));
    if (canonicalPayload(payload) !== envelope.payload) invalidContinuation();
    if (Date.parse(payload.expiresAt) <= now.getTime()) invalidContinuation();
    return payload;
  } catch {
    return invalidContinuation();
  }
}
