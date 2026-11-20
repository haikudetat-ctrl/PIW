import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isPreSaleStatus } from "@/domain/closeouts";
import { createServerClient } from "@/lib/supabase/server";

type QueueRow = {
  job_jnid: string;
  job_number: string | null;
  status_name: string | null;
  status_stage: string | null;
  customer_name: string | null;
  city: string | null;
  sales_rep_name: string | null;
  job_type: string | null;
  delivered_at: string | null;
  photo_count: number | null;
  closeout_id: string | null;
  closeout_status: string | null;
  homeowner_signed: boolean | null;
  submitted_at: string | null;
  writeback_state: string | null;
};

function shortDate(iso: string | null): string {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function statusBadge(row: QueueRow) {
  if (!row.status_name) return null;
  const tone: BadgeTone = isPreSaleStatus(row.status_name, row.status_stage) ? "warning" : "neutral";
  return (
    <Badge tone={tone} dot={tone === "warning"}>
      {tone === "warning" ? `JobNimbus says ${row.status_name}` : row.status_name}
    </Badge>
  );
}

function progressBadge(row: QueueRow) {
  if (row.closeout_status === "submitted") {
    if (row.writeback_state === "done") return <Badge tone="success">Filed in JobNimbus</Badge>;
    if (row.writeback_state === "failed") return <Badge tone="danger">Filing failed</Badge>;
    return <Badge tone="info">Filing to JobNimbus</Badge>;
  }
  if (row.closeout_status === "draft") {
    return row.homeowner_signed ? <Badge tone="info">Homeowner signed</Badge> : <Badge tone="neutral">Needs sign-off</Badge>;
  }
  return null;
}

function QueueList({ rows, empty }: { rows: QueueRow[]; empty: string }) {
  if (rows.length === 0) return <p className="px-5 pb-4 text-sm text-ink-subtle">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.job_jnid} className="border-b border-border last:border-b-0">
          <Link
            href={`/closeouts/${encodeURIComponent(row.job_jnid)}`}
            className="grid grid-cols-1 items-center gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-fill-hover sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">
                {row.customer_name ?? (row.job_number ? `Job #${row.job_number}` : "JobNimbus job")}
              </span>
              <span className="block truncate text-xs text-ink-subtle">
                {[row.city, row.job_type, row.sales_rep_name].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="text-xs text-ink-muted">
              {row.closeout_status === "submitted"
                ? `Submitted ${shortDate(row.submitted_at)}`
                : `Materials delivered ${shortDate(row.delivered_at)}`}
            </span>
            <span className="text-xs text-ink-muted">
              {row.photo_count ?? 0} {row.photo_count === 1 ? "photo" : "photos"} since delivery
            </span>
            <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              {progressBadge(row)}
              {statusBadge(row)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function CloseoutsPage() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("list_job_closeout_queue", { p_days: 60 });
  if (error) throw new Error("Failed to load the closeout queue");
  const rows = (data ?? []) as QueueRow[];

  const ready = rows.filter((row) => !row.closeout_id);
  const inProgress = rows.filter((row) => row.closeout_status === "draft");
  const submitted = rows.filter((row) => row.closeout_status === "submitted");

  return (
    <main className="flex flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Closeouts</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
          Jobs whose materials were delivered in the last 60 days. Each closeout starts filled in from JobNimbus: install days
          from the crew&apos;s photos, the supplier paperwork and the job&apos;s own fields.
        </p>
      </div>

      <Card title="Ready to close out" right={`${ready.length}`} flush>
        <QueueList rows={ready} empty="Nothing waiting. New jobs show up here when their delivery receipt reaches JobNimbus." />
      </Card>
      <Card title="In progress" right={`${inProgress.length}`} flush>
        <QueueList rows={inProgress} empty="No closeouts in progress." />
      </Card>
      <Card title="Submitted" right={`${submitted.length}`} flush>
        <QueueList rows={submitted} empty="Nothing submitted in the last 60 days." />
      </Card>
    </main>
  );
}
