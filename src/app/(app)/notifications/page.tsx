import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { markNotificationRead } from "./actions";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export default async function NotificationsPage() {
  const supabase = await createServerClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, lead_id, read_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Notifications</h1>

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {(notifications ?? []).map((notification) => (
          <li key={notification.id} className="flex flex-col gap-1.5 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm font-semibold text-ink">
                {notification.title}
              </strong>
              {notification.read_at ? (
                <Badge tone="neutral">Read</Badge>
              ) : (
                <Badge tone="warning">Unread</Badge>
              )}
            </div>
            <p className="text-sm text-ink-muted">{notification.body}</p>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs">
              <span className="text-ink-subtle">
                {formatDateTime(notification.created_at)}
              </span>
              {notification.lead_id ? (
                <Link
                  href={`/leads/${notification.lead_id}`}
                  className="font-medium text-accent hover:underline"
                >
                  View lead
                </Link>
              ) : null}
              {!notification.read_at ? (
                <form
                  action={async () => {
                    "use server";
                    await markNotificationRead(notification.id);
                  }}
                >
                  <button type="submit" className="font-medium text-accent hover:underline">
                    Mark read
                  </button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
        {(notifications ?? []).length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-ink-subtle">
            No notifications yet
          </li>
        ) : null}
      </ul>
    </main>
  );
}
