import { redirect } from "next/navigation";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { NotificationsBell } from "./notifications-bell";
import { PrimaryNav } from "./primary-nav";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABELS = {
  super_admin: "Super admin",
  company_admin: "Company admin",
  manager: "Manager",
  employee: "Employee",
} as const;

function AccessNotice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 text-center">
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
            {access.displayName}
            <span className="ml-2 text-xs text-ink-subtle">· {ROLE_LABELS[access.role]}</span>
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
