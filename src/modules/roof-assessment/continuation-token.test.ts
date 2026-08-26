import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { signContinuation, verifyContinuation } from "./continuation-token";

const signingKey = "0123456789abcdef0123456789abcdef";
const now = new Date("2026-08-26T18:00:00.000Z");
const payload = {
  attemptId: "11111111-1111-4111-8111-111111111111",
  secret: "a".repeat(64),
  expiresAt: "2026-08-26T18:15:00.000Z",
};

function independentlySignedToken(value: unknown) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", signingKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("assessment continuation tokens", () => {
  test("round-trips a valid continuation capability", async () => {
    const token = await signContinuation(payload, signingKey);

    await expect(verifyContinuation(token, signingKey, now)).resolves.toEqual(payload);
  });

  test("rejects a modified signature with a generic error", async () => {
    const token = await signContinuation(payload, signingKey);

    await expect(verifyContinuation(`${token.slice(0, -1)}x`, signingKey, now))
      .rejects.toThrow("Invalid continuation");
  });

  test("rejects an expired continuation with the same generic error", async () => {
    const token = await signContinuation(payload, signingKey);

    await expect(
      verifyContinuation(token, signingKey, new Date("2026-08-26T18:15:00.000Z")),
    ).rejects.toThrow("Invalid continuation");
  });

  test("rejects a payload with unrecognized fields", async () => {
    const token = independentlySignedToken({...payload, leadId: crypto.randomUUID()});

    await expect(verifyContinuation(token, signingKey, now))
      .rejects.toThrow("Invalid continuation");
  });

  test.each(["", "too-short", "é".repeat(15)])(
    "rejects a signing secret shorter than 32 UTF-8 bytes",
    async (weakKey) => {
      await expect(signContinuation(payload, weakKey)).rejects.toThrow("Invalid continuation");
      await expect(verifyContinuation("value.signature", weakKey, now))
        .rejects.toThrow("Invalid continuation");
    },
  );

  test.each(["", "one-part", "a.b.c", "***.***"])(
    "rejects malformed tokens without exposing parsing details",
    async (token) => {
      await expect(verifyContinuation(token, signingKey, now))
        .rejects.toThrow("Invalid continuation");
    },
  );
});
