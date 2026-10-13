import { redirect } from "next/navigation";
import { hasRole, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { SettingsNav } from "./settings-nav";

// Settings follows the Figma "Settings" frames: a grouped secondary nav beside
// the page. Only sections that exist are listed.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(data);
  if (!access || !hasRole(access, "company_admin")) redirect("/");

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <h1 className="mb-4 text-[22px] font-bold tracking-tight text-ink">Settings</h1>
        <SettingsNav isPlatformAdmin={access.isPlatformAdmin} />
      </div>
      {children}
    </div>
  );
}
