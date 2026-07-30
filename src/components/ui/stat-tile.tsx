export function StatTile({
  value,
  label,
  tone = "default",
}: {
  value: string | number;
  label: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const valueColor =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";

  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      <p className="mt-1 text-xs font-medium tracking-wide text-ink-subtle uppercase">
        {label}
      </p>
    </div>
  );
}
