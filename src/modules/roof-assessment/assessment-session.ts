import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { z } from "zod";

export const ASSESSMENT_SESSION_COOKIE = "as_roof_assessment";
const SESSION_VERSION = 1 as const;
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

const assessmentSessionSchema = z.strictObject({
  assessmentId: z.uuid(),
  version: z.literal(SESSION_VERSION),
  issuedAt: z.iso.datetime({offset: true}),
  expiresAt: z.iso.datetime({offset: true}),
});

export type AssessmentSession = z.infer<typeof assessmentSessionSchema>;

type SessionOptions = {
  now?: Date;
  nodeEnv: "development" | "test" | "production";
};

type AssessmentSessionCookieSink = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax";
      path: string;
      maxAge: number;
    },
  ) => unknown;
};

function validSigningKey(signingKey: string) {
  return Buffer.byteLength(signingKey, "utf8") >= 32;
}

function encodedPayload(payload: AssessmentSession) {
  const canonical = JSON.stringify({
    assessmentId: payload.assessmentId,
    expiresAt: payload.expiresAt,
    issuedAt: payload.issuedAt,
    version: payload.version,
  });
  return Buffer.from(canonical, "utf8").toString("base64url");
}

function signature(encoded: string, signingKey: string) {
  return createHmac("sha256", signingKey).update(encoded, "ascii").digest();
}

async function createAssessmentSession(
  assessmentId: string,
  signingKey: string,
  now: Date,
) {
  if (!validSigningKey(signingKey) || !Number.isFinite(now.getTime())) {
    throw new Error("Assessment session is not configured");
  }
  const payload = assessmentSessionSchema.parse({
    assessmentId,
    version: SESSION_VERSION,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DURATION_SECONDS * 1_000).toISOString(),
  });
  const encoded = encodedPayload(payload);
  return `${encoded}.${signature(encoded, signingKey).toString("base64url")}`;
}

export async function readAssessmentSession(
  cookieValue: string | undefined,
  signingKey: string,
  now: Date = new Date(),
): Promise<AssessmentSession | null> {
  try {
    if (!cookieValue || !validSigningKey(signingKey) || !Number.isFinite(now.getTime())) return null;
    const match = TOKEN_PATTERN.exec(cookieValue);
    if (!match) return null;
    const [, encoded, encodedSignature] = match;
    const supplied = Buffer.from(encodedSignature, "base64url");
    const expected = signature(encoded, signingKey);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const payload = assessmentSessionSchema.parse(decoded);
    if (encodedPayload(payload) !== encoded) return null;
    if (Date.parse(payload.expiresAt) <= now.getTime()) return null;
    if (Date.parse(payload.issuedAt) > now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setAssessmentSession(
  response: NextResponse,
  assessmentId: string,
  signingKey: string,
  options: SessionOptions,
) {
  return setAssessmentSessionCookie(
    response.cookies,
    assessmentId,
    signingKey,
    options,
  );
}

export async function setAssessmentSessionCookie(
  cookies: AssessmentSessionCookieSink,
  assessmentId: string,
  signingKey: string,
  options: SessionOptions,
) {
  const now = options.now ?? new Date();
  const value = await createAssessmentSession(
    assessmentId,
    signingKey,
    now,
  );
  cookies.set(ASSESSMENT_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: options.nodeEnv === "production",
    sameSite: "lax",
    path: "/roof-estimate",
    maxAge: SESSION_DURATION_SECONDS,
  });
}
