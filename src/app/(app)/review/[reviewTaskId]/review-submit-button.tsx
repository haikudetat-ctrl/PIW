"use client";

import { useFormStatus } from "react-dom";

export function ReviewSubmitButton({
  children,
  disabled = false,
  tone = "primary",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  tone?: "primary" | "danger" | "neutral";
}) {
  const { pending } = useFormStatus();
  const toneClass =
    tone === "primary"
      ? "bg-accent text-white hover:bg-accent-hover"
      : tone === "danger"
        ? "bg-danger text-white hover:opacity-90"
        : "border border-border-strong bg-surface text-ink hover:border-accent hover:text-accent";

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
