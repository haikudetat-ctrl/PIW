import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { formatNotificationBadge } from "@/modules/notifications/badge";

export async function NotificationsBell() {
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  const unread = count ?? 0;

  return (
    <Link
      href="/notifications"
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition ${
        unread > 0
          ? "bg-warning-bg text-warning hover:bg-warning-bg/80"
          : "text-ink-muted hover:text-ink"
      }`}
    >
      {formatNotificationBadge(unread)}
    </Link>
  );
}
