export function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Sentence case (only the leading letter capitalized) — distinct from
// humanize's Title Case (used for enum labels like pipeline stages).
export function sentenceCase(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// Sentence case with NJGIN kept as an acronym — used for provider/source names.
export function formatSource(value: string): string {
  return sentenceCase(value).replace(/^Njgin\b/, "NJGIN");
}

export function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
