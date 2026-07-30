export default function ReviewTaskLoading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p className="text-sm text-ink-subtle">Loading review evidence…</p>
    </main>
  );
}
