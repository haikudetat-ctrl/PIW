export default function ReviewQueueLoading() {
  return (
    <main
      className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Loading review queue…
      </p>
    </main>
  );
}
