import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { inputClasses, labelClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { createServerClient } from "@/lib/supabase/server";
import { resolveBookingConfiguration } from "@/modules/booking/booking-runtime";
import { formatDayRange } from "@/modules/booking/booking-format";
import { addBlackout, addRep, removeBlackout, updateRep } from "./actions";
import { BookingSettingsForm, type BookingSettingsValues } from "./booking-settings-form";

const DEFAULTS: BookingSettingsValues = {
  isEnabled: false,
  googleCalendarId: "",
  meetingTitle: "Virtual roof consultation",
  meetingDurationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferMinutes: 15,
  minimumNoticeMinutes: 240,
  bookingHorizonDays: 14,
  concurrentCapacity: 1,
  sendCalendarInvites: true,
  supportPhone: "",
  windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })),
};

export default async function BookingSettingsPage() {
  const supabase = await createServerClient();
  const [{ data: settings }, { data: windows }, { data: blackouts }, { data: reps }] = await Promise.all([
    supabase.from("booking_settings").select("*").maybeSingle(),
    supabase.from("booking_availability_windows").select("weekday, start_minute, end_minute").order("weekday"),
    supabase
      .from("booking_blackouts")
      .select("id, starts_at, ends_at, reason")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at"),
    supabase.from("reps").select("id, name, email, is_active").order("is_active", { ascending: false }).order("name"),
  ]);
  const configured = resolveBookingConfiguration() !== null;
  const timezone = settings?.timezone ?? "America/New_York";

  const values: BookingSettingsValues = settings
    ? {
        isEnabled: settings.is_enabled,
        googleCalendarId: settings.google_calendar_id ?? "",
        meetingTitle: settings.meeting_title,
        meetingDurationMinutes: settings.meeting_duration_minutes,
        slotIntervalMinutes: settings.slot_interval_minutes,
        bufferMinutes: settings.buffer_minutes,
        minimumNoticeMinutes: settings.minimum_notice_minutes,
        bookingHorizonDays: settings.booking_horizon_days,
        concurrentCapacity: settings.concurrent_capacity,
        sendCalendarInvites: settings.send_calendar_invites,
        supportPhone: settings.support_phone ?? "",
        windows: (windows ?? []).map((row) => ({ weekday: row.weekday, startMinute: row.start_minute, endMinute: row.end_minute })),
      }
    : DEFAULTS;

  return (
    <main className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-[28px] font-bold tracking-tight text-ink">Video booking</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Homeowners pick a time from these hours. New bookings land unassigned in Consultations for a manager to give to a rep.
        </p>
      </div>

      <Card
        title="Booking"
        right={
          configured ? (
            <Badge tone={values.isEnabled ? "success" : "neutral"}>{values.isEnabled ? "On" : "Off"}</Badge>
          ) : (
            <Badge tone="warning">Google not connected</Badge>
          )
        }
      >
        {!configured ? (
          <p className="mb-5 rounded-lg bg-warning-bg px-3 py-2 text-[13px] text-warning">
            The Google Workspace service account isn&apos;t configured for this deployment, so booking pages stay hidden even when this is on.
            See the virtual consultation booking runbook.
          </p>
        ) : null}
        <BookingSettingsForm values={values} />
      </Card>

      <Card title="Days off" ariaLabel="Days off">
        <p className="text-[13px] text-ink-muted">
          Whole days homeowners can&apos;t book, like holidays. For a few hours, block the time on the shared Google calendar instead.
        </p>
        {(blackouts ?? []).length ? (
          <ul className="mt-3 divide-y divide-border">
            {(blackouts ?? []).map((blackout) => (
              <li key={blackout.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="text-ink">
                  {formatDayRange(blackout.starts_at, blackout.ends_at, timezone)}
                  {blackout.reason ? <span className="text-ink-subtle"> · {blackout.reason}</span> : null}
                </span>
                <form action={removeBlackout}>
                  <input type="hidden" name="blackoutId" value={blackout.id} />
                  <button type="submit" className="text-[13px] font-medium text-tint hover:underline">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addBlackout} className="mt-4 grid items-end gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <label className="block">
            <span className={labelClasses}>First day</span>
            <input name="from" type="date" required className={inputClasses} />
          </label>
          <label className="block">
            <span className={labelClasses}>Last day</span>
            <input name="to" type="date" className={inputClasses} />
          </label>
          <label className="block">
            <span className={labelClasses}>Reason (optional)</span>
            <input name="reason" maxLength={200} className={inputClasses} />
          </label>
          <button type="submit" className={secondaryButtonClasses}>Add days off</button>
        </form>
      </Card>

      <Card title="Consultation reps" ariaLabel="Consultation reps">
        <p className="text-[13px] text-ink-muted">
          Managers assign these reps to booked consultations. A rep with an email is added to the Google invite.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {(reps ?? []).map((rep) => (
            <li key={rep.id} className="py-2.5">
              <form action={updateRep} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto_auto]">
                <input type="hidden" name="repId" value={rep.id} />
                <label className="block">
                  <span className={labelClasses}>Name</span>
                  <input name="name" required defaultValue={rep.name} className={inputClasses} />
                </label>
                <label className="block">
                  <span className={labelClasses}>Email for invites</span>
                  <input name="email" type="email" defaultValue={rep.email ?? ""} className={inputClasses} />
                </label>
                <label className="flex items-center gap-2 pb-2 text-[13px] text-ink">
                  <input type="checkbox" name="isActive" defaultChecked={rep.is_active} className="size-4" /> Active
                </label>
                <button type="submit" className={secondaryButtonClasses}>Save</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addRep} className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
          <label className="block">
            <span className={labelClasses}>New rep name</span>
            <input name="name" required maxLength={120} className={inputClasses} />
          </label>
          <label className="block">
            <span className={labelClasses}>Email for invites</span>
            <input name="email" type="email" maxLength={254} className={inputClasses} />
          </label>
          <button type="submit" className={primaryButtonClasses}>Add rep</button>
        </form>
      </Card>
    </main>
  );
}
