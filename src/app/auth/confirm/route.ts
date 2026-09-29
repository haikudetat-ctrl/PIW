import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  handleAuthConfirmation,
  handleAuthConfirmationSubmission,
} from "../redirect";

function invalidLinkResponse(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/login?error=invalid-link", request.url),
    303,
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    return handleAuthConfirmation(request, {
      verifyOtp: (input) => supabase.auth.verifyOtp(input),
      exchangeCodeForSession: (code) =>
        supabase.auth.exchangeCodeForSession(code),
    });
  } catch {
    return invalidLinkResponse(request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    return handleAuthConfirmationSubmission(request, {
      verifyOtp: (input) => supabase.auth.verifyOtp(input),
    });
  } catch {
    return invalidLinkResponse(request);
  }
}
