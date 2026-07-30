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
      ? "bg-blue-700 text-white hover:bg-blue-800 dark:bg-blue-500 dark:text-neutral-950"
      : tone === "danger"
        ? "bg-red-700 text-white hover:bg-red-800 dark:bg-red-500 dark:text-neutral-950"
        : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
