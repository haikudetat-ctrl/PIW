import type { ReactNode } from "react";

export function Card({
  title,
  right,
  children,
  ariaLabel,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className="rounded-lg border border-border bg-surface"
    >
      {(title || right) && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <h2 className="text-xs font-semibold tracking-wider text-ink uppercase">
            {title}
          </h2>
          {right && <div className="text-xs text-ink-subtle">{right}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
