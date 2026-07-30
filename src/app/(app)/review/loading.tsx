export default function ReviewQueueLoading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p className="text-sm text-ink-subtle">Loading review queue…</p>
    </main>
  );
}
