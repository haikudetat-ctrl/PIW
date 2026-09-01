import {createHmac} from "node:crypto";
import {describe, expect, test} from "vitest";
import {createConsentHandoff, verifyConsentHandoff} from "./consent-handoff";

const signingSecret = "0123456789abcdef0123456789abcdef";
const continuation = "signed-continuation-value";
const consent = {
  consentId: "11111111-1111-4111-8111-111111111111",
  policyVersion: "piw-privacy-v1" as const,
  analytics: false,
  advertising: true,
  issuedAt: "2026-09-01T16:00:00.000Z",
};

function signedPayload(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingSecret)
    .update(encoded, "ascii")
    .digest("base64url");
  return `${encoded}.${signature}`;
}

describe("consent handoff", () => {
  test("is short-lived and tamper evident", async () => {
    const token = await createConsentHandoff(consent, continuation, signingSecret);

    await expect(verifyConsentHandoff(
      token,
      continuation,
      signingSecret,
      new Date("2026-09-01T16:04:59Z"),
    )).resolves.toMatchObject({advertising: true});
    await expect(verifyConsentHandoff(
      `${token}x`,
      continuation,
      signingSecret,
    )).rejects.toThrow("Invalid consent handoff");
    await expect(verifyConsentHandoff(
      token,
      continuation,
      signingSecret,
      new Date("2026-09-01T16:05:01Z"),
    )).rejects.toThrow("Expired consent handoff");
  });

  test("binds the signature to the exact continuation", async () => {
    const token = await createConsentHandoff(consent, continuation, signingSecret);

    await expect(verifyConsentHandoff(
      token,
      `${continuation}-other`,
      signingSecret,
      new Date("2026-09-01T16:01:00Z"),
    )).rejects.toThrow("Invalid consent handoff");
  });

  test("rejects future, non-canonical, and policy-invalid payloads", async () => {
    const future = await createConsentHandoff(
      {...consent, issuedAt: "2026-09-01T16:00:31.000Z"},
      continuation,
      signingSecret,
    );
    await expect(verifyConsentHandoff(
      future,
      continuation,
      signingSecret,
      new Date("2026-09-01T16:00:00Z"),
    )).rejects.toThrow("Invalid consent handoff");

    await expect(verifyConsentHandoff(
      signedPayload({
        version: "piw-privacy-v0",
        consentId: consent.consentId,
        analytics: false,
        advertising: false,
        gpc: false,
        continuationHash: "a".repeat(64),
        issuedAt: consent.issuedAt,
      }),
      continuation,
      signingSecret,
      new Date("2026-09-01T16:00:01Z"),
    )).rejects.toThrow("Invalid consent handoff");

    const token = await createConsentHandoff(consent, continuation, signingSecret);
    const [encoded, signature] = token.split(".");
    await expect(verifyConsentHandoff(
      `${encoded}=.${signature}`,
      continuation,
      signingSecret,
    )).rejects.toThrow("Invalid consent handoff");
  });
});
