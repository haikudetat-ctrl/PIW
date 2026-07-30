import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NotificationsBell } from "./notifications-bell";
import { PrimaryNav } from "./primary-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("id, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 pt-4">
          <div>
            <p className="text-sm font-bold tracking-wide text-ink">
              Property Intelligence Worker
            </p>
            <p className="text-xs text-ink-subtle">
              New Jersey residential roofing
            </p>
          </div>
          <p className="text-sm text-ink-subtle">
            {adminProfile.display_name}
          </p>
        </div>
        <div className="mx-auto max-w-7xl px-6">
          <PrimaryNav notifications={<NotificationsBell />} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
