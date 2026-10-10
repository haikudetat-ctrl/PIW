export function StatTile({
  value,
  label,
  tone = "default",
  detail,
}: {
  value: string | number;
  label: string;
  tone?: "default" | "success" | "warning" | "danger";
  detail?: string;
}) {
  const detailColor =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-ink-subtle";

  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5 shadow-card">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p
        className={`mt-0.5 text-xl font-semibold tracking-tight ${
          tone === "default" || detail ? "text-ink" : detailColor
        }`}
      >
        {value}
      </p>
      {detail ? <p className={`mt-0.5 text-xs font-medium ${detailColor}`}>{detail}</p> : null}
    </div>
  );
}
