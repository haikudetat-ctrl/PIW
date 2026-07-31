import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">
            Property Intelligence Worker
          </p>
          <h1 className="mt-2 text-2xl font-bold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            New Jersey residential roofing
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
