import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { formatDateTime, humanize } from "@/lib/format";

const count = z.coerce.number().int().nonnegative();
const healthSchema = z.array(
  z.object({
    company_id: z.string(),
    name: z.string(),
    members: count,
    leads_7d: count,
    leads_total: count,
    jobnimbus_enabled: z.boolean(),
    jobnimbus_jobs: count,
    last_sync: z.object({ status: z.string(), started_at: z.string(), record_type: z.string() }).nullable(),
    failed_syncs_24h: count,
    unmapped_statuses: count,
    stuck_pipelines: count,
    open_reviews: count,
  }),
);

export default async function PlatformHealthPage() {
  const supabase = await createServerClient();
  const { data: accessRows } = await supabase.rpc("get_my_access");
  if (!parseMyAccess(accessRows)?.isPlatformAdmin) notFound();
  const { data, error } = await supabase.rpc("platform_health");
  if (error) throw new Error("Failed to load platform health");
  const companies = healthSchema.parse(data);
  const attention = companies.filter(
    (company) => company.failed_syncs_24h > 0 || company.stuck_pipelines > 0 || company.last_sync?.status === "failed",
  ).length;

  return (
    <main className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-[28px] font-bold tracking-tight text-ink">Platform health</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {companies.length} {companies.length === 1 ? "company" : "companies"}
          {attention > 0 ? ` · ${attention} need attention` : " · nothing failing"}
        </p>
      </div>

      <section aria-label="Companies" className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-[13px]">
            <thead className="border-b border-border text-left text-xs text-ink-subtle">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Members</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Leads (7 days)</th>
                <th scope="col" className="px-5 py-2.5 font-medium">JobNimbus</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Failed syncs (24 h)</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Unmapped statuses</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Stuck enrichments</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Open reviews</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.company_id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-5 py-3 text-left font-medium text-ink">{company.name}</th>
                  <td className="px-5 py-3 text-right tabular-nums">{company.members}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {company.leads_7d} <span className="text-ink-subtle">/ {company.leads_total}</span>
                  </td>
                  <td className="px-5 py-3">
                    {!company.jobnimbus_enabled ? (
                      <Badge tone="neutral">Off</Badge>
                    ) : company.last_sync ? (
                      <span className="flex flex-col gap-0.5">
                        <Badge tone={company.last_sync.status === "ok" ? "success" : company.last_sync.status === "running" ? "info" : "danger"}>
                          {humanize(company.last_sync.status)}
                        </Badge>
                        <span className="text-xs text-ink-subtle">
                          {company.jobnimbus_jobs.toLocaleString()} jobs · {formatDateTime(company.last_sync.started_at)}
                        </span>
                      </span>
                    ) : (
                      <Badge tone="warning">Never synced</Badge>
                    )}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${company.failed_syncs_24h > 0 ? "font-semibold text-danger" : ""}`}>
                    {company.failed_syncs_24h}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${company.unmapped_statuses > 0 ? "text-warning" : ""}`}>
                    {company.unmapped_statuses}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${company.stuck_pipelines > 0 ? "font-semibold text-danger" : ""}`}>
                    {company.stuck_pipelines}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{company.open_reviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
