import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";

function reasonLabel(reason: string): string {
  return reason
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

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
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Property identity
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Review queue
          </h1>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {tasks?.length ?? 0} open
        </p>
      </div>

      <section aria-label="Open review tasks">
        {(tasks ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 px-5 py-12 text-center dark:border-neutral-700">
            <h2 className="text-base font-medium">Queue is clear</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              New address or parcel exceptions will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {(tasks ?? []).map((task) => (
              <li key={task.id}>
                <Link
                  href={`/review/${task.id}`}
                  className="grid gap-2 px-4 py-4 outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset dark:hover:bg-neutral-900 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {task.leads?.name ?? "Unknown lead"}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {reasonLabel(task.reason)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-neutral-600 dark:text-neutral-400">
                      {task.leads?.submitted_address ?? "No submitted address"}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Review
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
