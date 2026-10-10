import { redirect } from "next/navigation";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "./app-sidebar";
import { SidebarSignOutButton, SignOutButton } from "./sign-out-button";

const ROLE_LABELS = {
  super_admin: "Super admin",
  company_admin: "Company admin",
  manager: "Manager",
  employee: "Employee",
} as const;

function AccessNotice({ title, body }: { title: string; body: string }) {
  return (
    <main className="admin-theme flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-card">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-subtle">{body}</p>
        <div className="mt-5">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(data);

  // Signed in but not provisioned (or deactivated): say so instead of
  // bouncing back to the login form, which looks like a failed sign-in.
  if (!access) {
    return (
      <AccessNotice
        title="No access yet"
        body="You're signed in, but your account isn't set up for a company. Ask your company admin to add you."
      />
    );
  }

  if (!canUseCrm(access)) {
    return (
      <AccessNotice
        title="Your dashboard is on the way"
        body="Your account is set up. Your personal customer view opens here once it launches."
      />
    );
  }

  const [{ count: unreadNotifications }, { count: reviewCount }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("review_tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  return (
    <div className="admin-theme flex min-h-screen flex-col md:flex-row">
      <AppSidebar
        displayName={access.displayName}
        roleLabel={ROLE_LABELS[access.role]}
        reviewCount={reviewCount ?? 0}
        unreadNotifications={unreadNotifications ?? 0}
        footer={<SidebarSignOutButton />}
      />
      {/* Pages render their own <main>. */}
      <div className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </div>
    </div>
  );
}
