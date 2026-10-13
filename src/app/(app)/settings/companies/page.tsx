import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { CompanySwitchButton, CreateCompanyForm } from "./company-controls";

export default async function CompaniesSettingsPage() {
  const supabase = await createServerClient();
  const [{ data: accessRows }, { data: companies, error }] = await Promise.all([
    supabase.rpc("get_my_access"),
    supabase.rpc("list_my_companies"),
  ]);
  const access = parseMyAccess(accessRows);
  if (!access?.isPlatformAdmin) notFound();
  if (error) throw new Error("Failed to load companies");

  return (
    <main className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-[28px] font-bold tracking-tight text-ink">Companies</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Every roofing company on Rake. As super admin you can work inside any of them.
        </p>
      </div>

      <section aria-label="Company list" className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <ul className="divide-y divide-border">
          {(companies ?? []).map((company) => (
            <li key={company.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <span className="text-[13px] font-medium text-ink">{company.name}</span>
              {company.is_current ? (
                <Badge tone="info">Current</Badge>
              ) : (
                <CompanySwitchButton companyId={company.id} name={company.name} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <CreateCompanyForm />
    </main>
  );
}
