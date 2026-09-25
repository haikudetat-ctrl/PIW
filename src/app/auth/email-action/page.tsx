import Link from "next/link";
import {
  safeAuthEmailOtpType,
  safeAuthNextPath,
} from "../redirect";

export const dynamic = "force-dynamic";

type EmailActionPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function singleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

export default async function EmailActionPage({
  searchParams,
}: EmailActionPageProps) {
  const params = await searchParams;
  const tokenHash = singleValue(params.token_hash);
  const type = safeAuthEmailOtpType(singleValue(params.type));

  if (!tokenHash || !type) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 text-center">
          <h1 className="text-xl font-bold text-ink">Invalid sign-in link</h1>
          <p className="mt-2 text-sm text-ink-subtle">
            Request a new link and try again.
          </p>
          <Link className="mt-5 inline-block text-sm text-accent" href="/login">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  const recovery = type === "recovery";
  const next = safeAuthNextPath(
    singleValue(params.next),
    recovery ? "/reset-password" : "/",
  );

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">
            Property Intelligence Worker
          </p>
          <h1 className="mt-2 text-2xl font-bold text-ink">
            {recovery ? "Reset your password" : "Confirm your sign-in"}
          </h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Click below to securely continue.
          </p>
        </div>
        <form
          action="/auth/confirm"
          className="rounded-lg border border-border bg-surface p-6"
          method="post"
        >
          <input name="token_hash" type="hidden" value={tokenHash} />
          <input name="type" type="hidden" value={type} />
          <input name="next" type="hidden" value={next} />
          <button
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white"
            type="submit"
          >
            {recovery ? "Continue to reset password" : "Continue to sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
