import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { FoundationDiagnostics } from "./foundation-diagnostics";

export default async function HomePage() {
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
    <main>
      <p>PIW · New Jersey residential roofing</p>
      <h1>Property Intelligence Worker</h1>
      <p>Foundation online</p>
      <FoundationDiagnostics />
    </main>
  );
}
