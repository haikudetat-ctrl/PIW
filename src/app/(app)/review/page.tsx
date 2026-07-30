import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";

export default async function ReviewQueuePage() {
  const supabase = await createServerClient();
  const { data: tasks, error } = await supabase
    .from("review_tasks")
    .select(
      "id, reason, status, created_at, property_id, leads(name, submitted_address)",
    )
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (error) throw new Error("Failed to load review queue");

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-ink-subtle uppercase">
            Property identity
          </p>
          <h1 className="mt-1 text-2xl font-bold text-ink">Review queue</h1>
        </div>
        <p className="text-sm text-ink-muted">{tasks?.length ?? 0} open</p>
      </div>

      <section aria-label="Open review tasks">
        {(tasks ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong px-5 py-12 text-center">
            <h2 className="text-base font-medium text-ink">Queue is clear</h2>
            <p className="mt-1 text-sm text-ink-subtle">
              New address or parcel exceptions will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {(tasks ?? []).map((task) => (
              <li key={task.id}>
                <Link
                  href={`/review/${task.id}`}
                  className="grid gap-2 px-5 py-4 outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">
                        {task.leads?.name ?? "Unknown lead"}
                      </span>
                      <Badge tone="warning">{humanize(task.reason)}</Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-ink-subtle">
                      {task.leads?.submitted_address ?? "No submitted address"}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-accent">Review</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
