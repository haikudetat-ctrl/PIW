import { createServerClient } from "@/lib/supabase/server";
import { markNotificationRead } from "./actions";

export default async function NotificationsPage() {
  const supabase = await createServerClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, lead_id, read_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <main>
      <h1>Notifications</h1>
      <ul>
        {(notifications ?? []).map((notification) => (
          <li key={notification.id}>
            <strong>{notification.title}</strong>
            <p>{notification.body}</p>
            {notification.lead_id ? <a href={`/leads/${notification.lead_id}`}>View lead</a> : null}
            {notification.read_at ? (
              <span>Read</span>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await markNotificationRead(notification.id);
                }}
              >
                <button type="submit">Mark read</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
