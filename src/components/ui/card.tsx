import type { ReactNode } from "react";

export function Card({
  title,
  right,
  children,
  ariaLabel,
  flush = false,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  // Flush cards let lists and tables run edge to edge (inset-grouped style).
  flush?: boolean;
}) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className="overflow-hidden rounded-2xl bg-surface shadow-card"
    >
      {(title || right) && (
        <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {right && <div className="text-xs text-ink-subtle">{right}</div>}
        </div>
      )}
      <div className={flush ? "pb-1" : "p-5 pt-3"}>{children}</div>
    </section>
  );
}
