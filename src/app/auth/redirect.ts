import { NextResponse, type NextRequest } from "next/server";

const AUTH_EMAIL_OTP_TYPES = new Set([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

export type AuthEmailOtpType =
  | "email"
  | "email_change"
  | "invite"
  | "magiclink"
  | "recovery"
  | "signup";

export function safeAuthNextPath(value: string | null, fallback = "/") {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
  ) {
    return fallback;
  }
  return value;
}

export type AuthConfirmationDependencies = {
  verifyOtp: (input: {
    token_hash: string;
    type: AuthEmailOtpType;
  }) => Promise<{ error: { message: string } | null }>;
  exchangeCodeForSession?: (code: string) => Promise<{
    error: { message: string } | null;
  }>;
};

function confirmationRedirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

function invalidConfirmation(request: NextRequest) {
  return confirmationRedirect(request, "/login?error=invalid-link");
}

export async function handleAuthConfirmation(
  request: NextRequest,
  dependencies: AuthConfirmationDependencies,
) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  if (code && dependencies.exchangeCodeForSession) {
    const next = safeAuthNextPath(searchParams.get("next"));
    const { error } = await dependencies.exchangeCodeForSession(code);
    if (error) return invalidConfirmation(request);
    return confirmationRedirect(request, next);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (!tokenHash || !type || !AUTH_EMAIL_OTP_TYPES.has(type)) {
    return invalidConfirmation(request);
  }

  const fallback = type === "recovery" ? "/reset-password" : "/";
  const next = safeAuthNextPath(searchParams.get("next"), fallback);
  const { error } = await dependencies.verifyOtp({
    token_hash: tokenHash,
    type: type as AuthEmailOtpType,
  });
  if (error) return invalidConfirmation(request);
  return confirmationRedirect(request, next);
}
