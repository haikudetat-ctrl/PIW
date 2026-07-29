import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { formatNotificationBadge } from "@/modules/notifications/badge";

export async function NotificationsBell() {
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return <Link href="/notifications">{formatNotificationBadge(count ?? 0)}</Link>;
}
