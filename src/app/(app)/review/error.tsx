"use client";

export default function ReviewQueueError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <section
        aria-label="Review queue error"
        className="rounded-lg border border-danger bg-danger-bg p-5 text-danger"
      >
        <h1 className="text-lg font-semibold">Review queue unavailable</h1>
        <p className="mt-1 text-sm">
          The queue could not be loaded. No review tasks were changed.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 min-h-11 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
