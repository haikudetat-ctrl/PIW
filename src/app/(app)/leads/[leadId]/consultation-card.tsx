import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMeetingTime } from "@/modules/booking/booking-format";
import { BookingLinkButton } from "./booking-link-button";

export type LeadConsultation = {
  id: string;
  status: string;
  scheduled_at: string;
  meeting_url: string | null;
  calendar_sync_status: string | null;
  rep_id: string | null;
  customer_notes: string | null;
};

/** The lead's next video consultation, and a booking link to send when there isn't one. */
export function ConsultationCard({
  leadId,
  consultations,
  timezone,
  bookingEnabled,
}: {
  leadId: string;
  consultations: LeadConsultation[];
  timezone: string;
  bookingEnabled: boolean;
}) {
  const now = new Date().getTime();
  const next = consultations
    .filter((row) => ["scheduled", "confirmed"].includes(row.status) && new Date(row.scheduled_at).getTime() >= now)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];

  return (
    <Card title="Video consultation" ariaLabel="Video consultation">
      {next ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">{formatMeetingTime(next.scheduled_at, timezone)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {next.rep_id ? <Badge tone="success">Rep assigned</Badge> : <Badge tone="warning">Needs a rep</Badge>}
            {next.calendar_sync_status === "synced" && next.meeting_url ? (
              <a href={next.meeting_url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-tint hover:underline">
                Open Meet
              </a>
            ) : (
              <Badge tone={next.calendar_sync_status === "failed" ? "danger" : "info"}>
                {next.calendar_sync_status === "failed" ? "Calendar failed" : "Syncing calendar"}
              </Badge>
            )}
          </div>
          {next.customer_notes ? <p className="text-[13px] text-ink-muted">&ldquo;{next.customer_notes}&rdquo;</p> : null}
          <Link href="/appointments" className="text-[13px] font-medium text-tint hover:underline">Manage in Consultations</Link>
        </div>
      ) : bookingEnabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-ink-muted">
            Send the homeowner their booking link so they can pick a video call time themselves.
          </p>
          <BookingLinkButton leadId={leadId} />
        </div>
      ) : (
        <p className="text-[13px] text-ink-subtle">Video booking is off. A company admin can turn it on in Settings.</p>
      )}
    </Card>
  );
}
