import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "../login/login-form";

export default async function ResetPasswordPage() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  const hasRecoverySession = !error && Boolean(data.user);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">
            Property Intelligence Worker
          </p>
          <h1 className="mt-2 text-2xl font-bold text-ink">Set a new password</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Choose a password with at least 8 characters.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          {hasRecoverySession ? (
            <ResetPasswordForm />
          ) : (
            <div className="space-y-4 text-sm text-ink-muted">
              <p role="alert">This recovery link is invalid or has expired.</p>
              <Link
                href="/forgot-password"
                className="font-medium text-accent hover:underline"
              >
                Request a new recovery link
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
