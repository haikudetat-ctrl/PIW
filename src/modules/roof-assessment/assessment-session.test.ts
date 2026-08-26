import { NextResponse } from "next/server";
import { describe, expect, test } from "vitest";
import { readAssessmentSession, setAssessmentSession } from "./assessment-session";

const signingKey = "0123456789abcdef0123456789abcdef";
const assessmentId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-26T18:00:00.000Z");

describe("roof assessment browser session", () => {
  test("sets a production cookie scoped to the roof assessment for 30 days", async () => {
    const response = NextResponse.json({ok: true});

    await setAssessmentSession(response, assessmentId, signingKey, {
      now,
      nodeEnv: "production",
    });

    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("as_roof_assessment=");
    expect(header).toContain("Path=/roof-estimate");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Max-Age=2592000");

    await expect(
      readAssessmentSession(response.cookies.get("as_roof_assessment")?.value, signingKey, now),
    ).resolves.toEqual({
      assessmentId,
      version: 1,
      issuedAt: "2026-08-26T18:00:00.000Z",
      expiresAt: "2026-09-25T18:00:00.000Z",
    });
  });

  test("does not mark a development cookie Secure", async () => {
    const response = NextResponse.json({ok: true});

    await setAssessmentSession(response, assessmentId, signingKey, {
      now,
      nodeEnv: "development",
    });

    expect(response.headers.get("set-cookie")).not.toContain("; Secure");
  });

  test("rejects a cookie whose signature was changed", async () => {
    const response = NextResponse.json({ok: true});
    await setAssessmentSession(response, assessmentId, signingKey, {now, nodeEnv: "test"});
    const cookie = response.cookies.get("as_roof_assessment")?.value ?? "";

    await expect(readAssessmentSession(`${cookie.slice(0, -1)}x`, signingKey, now))
      .resolves.toBeNull();
  });

  test("rejects the cookie at its exact expiry", async () => {
    const response = NextResponse.json({ok: true});
    await setAssessmentSession(response, assessmentId, signingKey, {now, nodeEnv: "test"});

    await expect(
      readAssessmentSession(
        response.cookies.get("as_roof_assessment")?.value,
        signingKey,
        new Date("2026-09-25T18:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });
});
