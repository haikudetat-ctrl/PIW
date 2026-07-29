"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

export async function markNotificationRead(notificationId: string) {
  const supabase = await createServerClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  // "layout" also revalidates the shared (app) layout — and its
  // NotificationsBell — on every route, not just /notifications.
  revalidatePath("/notifications", "layout");
}
