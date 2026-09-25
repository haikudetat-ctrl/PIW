import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import * as authFlow from "../redirect";

type ConfirmationHandler = (
  request: NextRequest,
  dependencies: {
    verifyOtp: (input: { token_hash: string; type: string }) => Promise<{
      error: { message: string } | null;
    }>;
    exchangeCodeForSession?: (code: string) => Promise<{
      error: { message: string } | null;
    }>;
  },
) => Promise<Response>;

const handleAuthConfirmation = (
  authFlow as unknown as { handleAuthConfirmation: ConfirmationHandler }
).handleAuthConfirmation;

const handleAuthConfirmationSubmission = (
  authFlow as unknown as {
    handleAuthConfirmationSubmission?: ConfirmationHandler;
  }
).handleAuthConfirmationSubmission;

test("requires a deliberate form submission before verifying an email token", async () => {
  expect(typeof handleAuthConfirmationSubmission).toBe("function");

  const verifyOtp = vi.fn(async () => ({ error: null }));
  const form = new FormData();
  form.set("token_hash", "secure-token");
  form.set("type", "recovery");
  form.set("next", "/reset-password");
  const request = new NextRequest(
    "https://piw-sepia.vercel.app/auth/confirm",
    { method: "POST", body: form },
  );

  const response = await handleAuthConfirmationSubmission!(request, { verifyOtp });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://piw-sepia.vercel.app/reset-password",
  );
  expect(verifyOtp).toHaveBeenCalledWith({
    token_hash: "secure-token",
    type: "recovery",
  });
});

test("verifies a recovery token and continues to the reset form", async () => {
  const verifyOtp = vi.fn(async () => ({ error: null }));
  const request = new NextRequest(
    "https://piw-sepia.vercel.app/auth/confirm?token_hash=secure-token&type=recovery&next=/reset-password",
  );

  const response = await handleAuthConfirmation(request, { verifyOtp });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://piw-sepia.vercel.app/reset-password",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(verifyOtp).toHaveBeenCalledWith({
    token_hash: "secure-token",
    type: "recovery",
  });
});

test("exchanges a PKCE recovery code and continues to the reset form", async () => {
  const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
  const verifyOtp = vi.fn();
  const request = new NextRequest(
    "https://piw-sepia.vercel.app/auth/confirm?code=auth-code&next=/reset-password",
  );

  const response = await handleAuthConfirmation(request, {
    verifyOtp,
    exchangeCodeForSession,
  });

  expect(response.headers.get("location")).toBe(
    "https://piw-sepia.vercel.app/reset-password",
  );
  expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
  expect(verifyOtp).not.toHaveBeenCalled();
});

test("uses the recovery destination instead of an external next URL", async () => {
  const response = await handleAuthConfirmation(
    new NextRequest(
      "https://piw-sepia.vercel.app/auth/confirm?token_hash=secure-token&type=recovery&next=//attacker.example",
    ),
    { verifyOtp: vi.fn(async () => ({ error: null })) },
  );

  expect(response.headers.get("location")).toBe(
    "https://piw-sepia.vercel.app/reset-password",
  );
});

test("returns an invalid-link login state without leaking verification errors", async () => {
  const response = await handleAuthConfirmation(
    new NextRequest(
      "https://piw-sepia.vercel.app/auth/confirm?token_hash=expired&type=email",
    ),
    {
      verifyOtp: vi.fn(async () => ({
        error: { message: "Token has expired for user@example.com" },
      })),
    },
  );

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://piw-sepia.vercel.app/login?error=invalid-link",
  );
  expect(await response.text()).not.toContain("user@example.com");
});

test("rejects unknown email token types before verification", async () => {
  const verifyOtp = vi.fn();
  const response = await handleAuthConfirmation(
    new NextRequest(
      "https://piw-sepia.vercel.app/auth/confirm?token_hash=token&type=access_token",
    ),
    { verifyOtp },
  );

  expect(response.headers.get("location")).toBe(
    "https://piw-sepia.vercel.app/login?error=invalid-link",
  );
  expect(verifyOtp).not.toHaveBeenCalled();
});
