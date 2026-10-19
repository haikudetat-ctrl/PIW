import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { inputClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { hasRole, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { formatMeetingTimeShort, timeZoneAbbreviation } from "@/modules/booking/booking-format";
import {
  assignRepFromForm,
  cancelVirtualConsultation,
  recordConsultationOutcome,
  retryCalendarSync,
} from "./actions";

type Row = {
  id: string;
  lead_id: string;
  rep_id: string | null;
  status: string;
  scheduled_at: string;
  duration_minutes: number | null;
  meeting_url: string | null;
  calendar_sync_status: string | null;
  calendar_sync_error: string | null;
  customer_notes: string | null;
  booking_source: string | null;
  leads: { name: string; phone: string } | null;
};

type Rep = { id: string; name: string; email: string | null };

const SYNC_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  synced: { tone: "success", label: "Meet ready" },
  pending: { tone: "info", label: "Syncing" },
  failed: { tone: "danger", label: "Calendar failed" },
  not_configured: { tone: "warning", label: "No calendar" },
};

function MeetingStatus({ row }: { row: Row }) {
  const badge = SYNC_BADGE[row.calendar_sync_status ?? "pending"] ?? SYNC_BADGE.pending;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span title={row.calendar_sync_error ?? undefined}>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </span>
      {row.calendar_sync_status === "synced" && row.meeting_url ? (
        <a href={row.meeting_url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-tint hover:underline">
          Open Meet
        </a>
      ) : null}
      {row.calendar_sync_status === "failed" || row.calendar_sync_status === "not_configured" ? (
        <form action={retryCalendarSync}>
          <input type="hidden" name="appointmentId" value={row.id} />
          <button type="submit" className="text-[13px] font-medium text-tint hover:underline">Retry</button>
        </form>
      ) : null}
    </div>
  );
}

function AssignRep({ row, reps }: { row: Row; reps: Rep[] }) {
  if (reps.length === 0) {
    return <span className="text-[13px] text-ink-subtle">Add reps in Settings</span>;
  }
  return (
    <form action={assignRepFromForm} className="flex items-center gap-2">
      <input type="hidden" name="appointmentId" value={row.id} />
      <label className="sr-only" htmlFor={`rep-${row.id}`}>Rep for {row.leads?.name ?? "this consultation"}</label>
      <select id={`rep-${row.id}`} name="repId" defaultValue={row.rep_id ?? ""} required className={`${inputClasses} mt-0 w-44 py-1.5`}>
        <option value="" disabled>Choose a rep</option>
        {reps.map((rep) => (
          <option key={rep.id} value={rep.id}>
            {rep.name}{rep.email ? "" : " (no email)"}
          </option>
        ))}
      </select>
      <button type="submit" className={row.rep_id ? secondaryButtonClasses : primaryButtonClasses}>
        {row.rep_id ? "Change" : "Assign"}
      </button>
    </form>
  );
}

function CancelControl({ row }: { row: Row }) {
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer list-none text-ink-subtle hover:text-ink">Cancel…</summary>
      <form action={cancelVirtualConsultation} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="appointmentId" value={row.id} />
        <span className="text-ink-muted">The homeowner is emailed.</span>
        <button type="submit" className="font-medium text-danger hover:underline">Cancel consultation</button>
      </form>
    </details>
  );
}

function OutcomeControl({ row }: { row: Row }) {
  return (
    <div className="flex items-center gap-2">
      {(["completed", "no_show"] as const).map((outcome) => (
        <form key={outcome} action={recordConsultationOutcome}>
          <input type="hidden" name="appointmentId" value={row.id} />
          <input type="hidden" name="outcome" value={outcome} />
          <button type="submit" className={secondaryButtonClasses}>
            {outcome === "completed" ? "Held" : "No-show"}
          </button>
        </form>
      ))}
    </div>
  );
}

function ConsultationTable({
  rows,
  reps,
  timezone,
  variant,
}: {
  rows: Row[];
  reps: Rep[];
  timezone: string;
  variant: "upcoming" | "past";
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-[13px]">
        <thead className="border-b border-border text-left text-xs text-ink-subtle">
          <tr>
            <th scope="col" className="px-5 py-2.5 font-medium">When</th>
            <th scope="col" className="px-5 py-2.5 font-medium">Homeowner</th>
            <th scope="col" className="px-5 py-2.5 font-medium">{variant === "past" ? "Outcome" : "Rep"}</th>
            <th scope="col" className="px-5 py-2.5 font-medium">Meeting</th>
            {variant === "upcoming" ? <th scope="col" className="px-5 py-2.5 font-medium"><span className="sr-only">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top last:border-b-0">
              <td className="px-5 py-3 whitespace-nowrap">
                <span className="block font-medium text-ink tabular-nums">{formatMeetingTimeShort(row.scheduled_at, timezone)}</span>
                <span className="block text-xs text-ink-subtle">
                  {row.duration_minutes ?? 30} min · {timeZoneAbbreviation(row.scheduled_at, timezone)}
                </span>
              </td>
              <td className="max-w-[18rem] px-5 py-3">
                <Link href={`/leads/${row.lead_id}`} className="font-medium text-ink hover:text-tint">
                  {row.leads?.name ?? "Lead"}
                </Link>
                {row.customer_notes ? (
                  <span className="mt-0.5 block truncate text-xs text-ink-subtle" title={row.customer_notes}>
                    {row.customer_notes}
                  </span>
                ) : null}
              </td>
              <td className="px-5 py-3">
                {variant === "past" ? <OutcomeControl row={row} /> : <AssignRep row={row} reps={reps} />}
              </td>
              <td className="px-5 py-3"><MeetingStatus row={row} /></td>
              {variant === "upcoming" ? <td className="px-5 py-3 text-right"><CancelControl row={row} /></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AppointmentsPage() {
  const supabase = await createServerClient();
  const requestedAt = new Date();
  const since = new Date(requestedAt.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const [{ data: accessRows }, { data: rows, error }, { data: reps }, { data: settings }] = await Promise.all([
    supabase.rpc("get_my_access"),
    supabase
      .from("appointments")
      .select("id, lead_id, rep_id, status, scheduled_at, duration_minutes, meeting_url, calendar_sync_status, calendar_sync_error, customer_notes, booking_source, leads(name, phone)")
      .eq("meeting_type", "virtual")
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", since)
      .order("scheduled_at", { ascending: true })
      .limit(200),
    supabase.from("reps").select("id, name, email").eq("is_active", true).order("name"),
    supabase.from("booking_settings").select("is_enabled, timezone").maybeSingle(),
  ]);
  if (error) throw new Error("Failed to load consultations");
  const access = parseMyAccess(accessRows);
  const timezone = settings?.timezone ?? "America/New_York";
  const now = requestedAt.getTime();
  const all = (rows ?? []) as Row[];
  const upcoming = all.filter((row) => new Date(row.scheduled_at).getTime() >= now);
  const needsRep = upcoming.filter((row) => !row.rep_id);
  const assigned = upcoming.filter((row) => row.rep_id);
  const needsOutcome = all.filter((row) => new Date(row.scheduled_at).getTime() < now);

  return (
    <main className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px] font-bold tracking-tight text-ink">Video consultations</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {upcoming.length} upcoming
            {needsRep.length > 0 ? ` · ${needsRep.length} need a rep` : ""}
            {needsOutcome.length > 0 ? ` · ${needsOutcome.length} need an outcome` : ""}
          </p>
        </div>
        {access && hasRole(access, "company_admin") ? (
          <Link href="/settings/booking" className={secondaryButtonClasses}>
            <Icon name="settings" size={14} /> Booking settings
          </Link>
        ) : null}
      </div>

      {!settings?.is_enabled ? (
        <Card ariaLabel="Booking is off">
          <p className="text-sm text-ink">
            Online booking is off, so homeowners can&apos;t pick times yet.
            {access && hasRole(access, "company_admin") ? " Set your hours and calendar in Booking settings to turn it on." : " Ask a company admin to turn it on."}
          </p>
        </Card>
      ) : null}

      <Card title="Needs a rep" right={needsRep.length ? `${needsRep.length}` : undefined} flush>
        {needsRep.length ? (
          <ConsultationTable rows={needsRep} reps={(reps ?? []) as Rep[]} timezone={timezone} variant="upcoming" />
        ) : (
          <p className="px-5 pb-4 text-[13px] text-ink-subtle">Every upcoming consultation has a rep.</p>
        )}
      </Card>

      <Card title="Upcoming" right={assigned.length ? `${assigned.length}` : undefined} flush>
        {assigned.length ? (
          <ConsultationTable rows={assigned} reps={(reps ?? []) as Rep[]} timezone={timezone} variant="upcoming" />
        ) : (
          <p className="px-5 pb-4 text-[13px] text-ink-subtle">No assigned consultations coming up.</p>
        )}
      </Card>

      {needsOutcome.length ? (
        <Card title="Needs an outcome" right="Last 7 days" flush>
          <ConsultationTable rows={needsOutcome} reps={[]} timezone={timezone} variant="past" />
        </Card>
      ) : null}
    </main>
  );
}
