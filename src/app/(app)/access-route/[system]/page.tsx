import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { humanize } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { summarizeIntakeBySource } from "@/modules/access-route/intake-quality";
import { JobNimbusConnectionPanel } from "./jobnimbus-connection-panel";
import { LeadConduitIntake } from "./leadconduit-intake";

const SYSTEMS = ["leadconduit", "leadmaster", "jobnimbus"] as const;
type System = typeof SYSTEMS[number];

function isSystem(value: string): value is System {
  return (SYSTEMS as readonly string[]).includes(value);
}

function show(value: string | number | null) {
  return value === null || value === "" ? "—" : String(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;
// About 25 leads a day today; the scorecard notes when the window is cut off.
const INTAKE_ROW_LIMIT = 1000;
const FEED_SIZE = 50;

async function renderLeadConduitPage() {
  const supabase = await createServerClient();
  const now = new Date();
  const since30Days = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const since7Days = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const [quality, raw, downstream] = await Promise.all([
    supabase.from("leadconduit_intake_quality")
      .select("flow_id, lead_id, source_name, received_at, lead_name, city, state, has_address, has_trustedform, has_phone, has_email, contact_redacted, repeat_of_received_at, repeat_of_source_name, jobnimbus_contact_since, service_states")
      .gte("received_at", since30Days)
      .order("received_at", { ascending: false })
      .limit(INTAKE_ROW_LIMIT),
    supabase.from("leadconduit_events")
      .select("event_id, flow_id, source_name, event_type, raw_status, reason_category, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase.from("leadconduit_events").select("id", { count: "exact", head: true })
      .in("event_type", ["shadow_checkpoint", "checkpoint_delivered"])
      .gte("occurred_at", since7Days),
  ]);
  if (quality.error) throw new Error("Unable to load LeadConduit intake quality");

  const rows = quality.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/access-route" className="text-sm font-medium text-accent hover:underline">← Access Route</Link>
        <h1 className="mt-2 text-[28px] font-bold tracking-tight text-ink">LeadConduit leads</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Live intake from LeadConduit, newest first, in Eastern time. Phone and email are used for matching but not shown.
        </p>
      </div>
      <LeadConduitIntake
        scorecard={summarizeIntakeBySource(rows, now)}
        leads={rows.slice(0, FEED_SIZE)}
        rawEvents={raw.data ?? []}
        downstreamLive={(downstream.count ?? 0) > 0}
        truncated={rows.length >= INTAKE_ROW_LIMIT}
        now={now}
      />
    </div>
  );
}

export default async function AccessRouteSystemPage({ params }: { params: Promise<{ system: string }> }) {
  const { system } = await params;
  if (!isSystem(system)) notFound();
  if (system === "leadconduit") return renderLeadConduitPage();
  const supabase = await createServerClient();

  const rows = system === "leadmaster"
    ? (await supabase.from("leadmaster_records").select("record_id, record_kind, workgroup, disposition, opportunity_status, entered_at").order("entered_at", { ascending: false }).limit(100)).data?.map((row) => [row.record_id, row.record_kind, row.workgroup, row.opportunity_status ?? row.disposition, row.entered_at])
    : (await supabase.from("jobnimbus_jobs").select("job_id, contact_id, status, stage, appointment_status, appointment_at, vendor_updated_at").order("vendor_updated_at", { ascending: false }).limit(100)).data?.map((row) => [row.job_id, row.contact_id, row.stage ?? row.status, row.appointment_status, row.appointment_at ?? row.vendor_updated_at]);

  const headers = system === "leadmaster"
    ? ["Record", "Kind", "Workgroup", "Raw status", "Date entered"]
    : ["Job", "Contact", "Raw status", "Appointment", "Updated"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/access-route" className="text-sm font-medium text-accent hover:underline">← Access Route</Link>
        <h1 className="mt-2 text-[28px] font-bold tracking-tight text-ink">{humanize(system)} records</h1>
        <p className="mt-1 text-sm text-ink-subtle">Latest 100 normalized read-only records. Raw vendor status is intentionally preserved.</p>
      </div>
      {system === "jobnimbus" ? <JobNimbusConnectionPanel /> : null}
      <Card title={`${humanize(system)} drill-down`} ariaLabel={`${humanize(system)} records`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-border text-xs text-ink-subtle">
              <tr>{headers.map((header) => <th key={header} className="pb-2 pr-4 font-medium last:pr-0">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(rows ?? []).map((row, index) => (
                <tr key={`${row[0]}-${index}`}>{row.map((value, cell) => <td key={cell} className="py-3 pr-4 text-ink-muted last:pr-0">{show(value)}</td>)}</tr>
              ))}
              {!rows?.length ? <tr><td colSpan={headers.length} className="py-6 text-center text-ink-subtle">No records ingested yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
