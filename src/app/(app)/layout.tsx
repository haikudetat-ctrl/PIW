import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) redirect("/login");

  return (
    <div>
      <header>
        <nav aria-label="Primary">
          <Link href="/">Dashboard</Link>
          <Link href="/pipeline">Pipeline</Link>
          <Link href="/leads/new">New lead</Link>
          <Link href="/notifications">Notifications</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
