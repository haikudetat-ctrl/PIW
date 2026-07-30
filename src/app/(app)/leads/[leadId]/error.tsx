"use client";

export default function LeadWorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section
        aria-label="Lead workspace error"
        className="rounded-lg border border-red-300 bg-red-50 p-5 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      >
        <h1 className="text-lg font-semibold">Lead workspace unavailable</h1>
        <p className="mt-1 text-sm">
          This lead could not be loaded. No lead or property data was changed.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 min-h-11 rounded-md bg-red-900 px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 dark:bg-red-100 dark:text-red-950"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
