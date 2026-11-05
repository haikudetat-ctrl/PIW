import { RakeLogo } from "@/components/brand/rake-logo";
import Link from "next/link";
import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  // /auth/confirm sends dead or already-used email links here. Without a
  // notice, an invited user sees a plain sign-in screen and has no password.
  const invalidLink = params.error === "invalid-link";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <RakeLogo className="mx-auto h-5 w-auto text-ink" />
          <h1 className="mt-2 text-2xl font-bold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Roofing operations
          </p>
        </div>
        {invalidLink ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-border bg-surface p-4 text-sm text-ink-muted"
          >
            <p>That email link has expired or was already used.</p>
            <Link
              href="/forgot-password"
              className="mt-2 inline-block font-medium text-accent hover:underline"
            >
              Email me a new link to set my password
            </Link>
          </div>
        ) : null}
        <div className="rounded-lg border border-border bg-surface p-6">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-ink-subtle">
          New to Rake?{" "}
          <a href="https://2-stack.com/rake" className="font-medium text-accent hover:underline">
            See what it does
          </a>
        </p>
      </div>
    </main>
  );
}
