import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { humanize } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";

const SYSTEMS = ["leadconduit", "leadmaster", "jobnimbus"] as const;
type System = typeof SYSTEMS[number];

function isSystem(value: string): value is System {
  return (SYSTEMS as readonly string[]).includes(value);
}

function show(value: string | number | null) {
  return value === null || value === "" ? "—" : String(value);
}

export default async function AccessRouteSystemPage({ params }: { params: Promise<{ system: string }> }) {
  const { system } = await params;
  if (!isSystem(system)) notFound();
  const supabase = await createServerClient();

  const rows = system === "leadconduit"
    ? (await supabase.from("leadconduit_events").select("event_id, flow_id, source_name, event_type, outcome, occurred_at").order("occurred_at", { ascending: false }).limit(100)).data?.map((row) => [row.event_id, row.source_name ?? row.flow_id, row.event_type, row.outcome, row.occurred_at])
    : system === "leadmaster"
      ? (await supabase.from("leadmaster_records").select("record_id, record_kind, workgroup, disposition, opportunity_status, entered_at").order("entered_at", { ascending: false }).limit(100)).data?.map((row) => [row.record_id, row.record_kind, row.workgroup, row.opportunity_status ?? row.disposition, row.entered_at])
      : (await supabase.from("jobnimbus_jobs").select("job_id, contact_id, status, stage, appointment_status, appointment_at, vendor_updated_at").order("vendor_updated_at", { ascending: false }).limit(100)).data?.map((row) => [row.job_id, row.contact_id, row.stage ?? row.status, row.appointment_status, row.appointment_at ?? row.vendor_updated_at]);

  const headers = system === "leadconduit"
    ? ["Event", "Source / flow", "Type", "Outcome", "Occurred"]
    : system === "leadmaster"
      ? ["Record", "Kind", "Workgroup", "Raw status", "Date entered"]
      : ["Job", "Contact", "Raw status", "Appointment", "Updated"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/access-route" className="text-sm font-medium text-accent hover:underline">← Access Route</Link>
        <h1 className="mt-2 text-2xl font-bold text-ink">{humanize(system)} records</h1>
        <p className="mt-1 text-sm text-ink-subtle">Latest 100 normalized read-only records. Raw vendor status is intentionally preserved.</p>
      </div>
      <Card title={`${humanize(system)} drill-down`} ariaLabel={`${humanize(system)} records`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-subtle">
              <tr>{headers.map((header) => <th key={header} className="pb-2 pr-4 font-medium last:pr-0">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(rows ?? []).map((row, index) => (
                <tr key={`${row[0]}-${index}`}>{row.map((value, cell) => <td key={cell} className="py-3 pr-4 text-ink-muted last:pr-0">{show(value)}</td>)}</tr>
              ))}
              {!rows?.length ? <tr><td colSpan={5} className="py-6 text-center text-ink-subtle">No records ingested yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
