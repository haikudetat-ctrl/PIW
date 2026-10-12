import { RakeLogo } from "@/components/brand/rake-logo";
import { ForgotPasswordForm } from "../login/login-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <RakeLogo className="mx-auto h-5 w-auto text-ink" />
          <h1 className="mt-2 text-2xl font-bold text-ink">Recover your password</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            We’ll email you a secure recovery link.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <ForgotPasswordForm />
        </div>
      </div>
    </main>
  );
}
