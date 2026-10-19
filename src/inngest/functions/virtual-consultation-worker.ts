import "server-only";
import {
  appointmentRepAssigned,
  inngest,
  virtualConsultationBooked,
  virtualConsultationCancelled,
  virtualConsultationRescheduled,
  virtualConsultationSyncRequested,
} from "@/inngest/client";
import {createServiceClient} from "@/lib/supabase/service";
import type {BookingEmailKind} from "@/modules/booking/booking-emails";
import {buildBookingUrl, resolveBookingConfiguration} from "@/modules/booking/booking-runtime";
import {runCalendarSync} from "@/modules/booking/calendar-sync";
import {reminderTimes, sendBookingEmail, type BookingEmailDependencies} from "@/modules/booking/send-booking-email";
import {loadBrandName, SupabaseCalendarSyncRepository} from "@/modules/booking/supabase-calendar-sync-repository";

const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const SETTLE_BEFORE_EMAIL = "20s";

/** Keeps Google Calendar in step with PIW for one appointment at a time. */
export const virtualConsultationCalendarSync = inngest.createFunction(
  {
    id: "virtual-consultation-calendar-sync",
    triggers: [
      {event: virtualConsultationBooked},
      {event: virtualConsultationRescheduled},
      {event: virtualConsultationCancelled},
      {event: appointmentRepAssigned},
      {event: virtualConsultationSyncRequested},
    ],
    concurrency: {key: "event.data.data.appointmentId", limit: 1},
    retries: 4,
  },
  async ({event, step}) => {
    const appointmentId = event.data.data.appointmentId;
    const result = await step.run("sync-calendar", async () => {
      const configuration = resolveBookingConfiguration();
      return runCalendarSync(appointmentId, {
        repository: new SupabaseCalendarSyncRepository(createServiceClient()),
        calendar: configuration?.calendar ?? null,
        waitForConference: () => new Promise((resolve) => setTimeout(resolve, 3_000)),
      });
    });
    console.info("virtual_consultation_calendar_sync", {appointmentId, trigger: event.name, ...result});
    return result;
  },
);

function createEmailDependencies(): BookingEmailDependencies | null {
  const configuration = resolveBookingConfiguration();
  if (!configuration?.resendApiKey || !configuration.fromEmail) return null;
  const {resendApiKey, fromEmail} = configuration;
  const client = createServiceClient();
  return {
    async load(appointmentId) {
      const {data: appointment} = await client
        .from("appointments")
        .select("id, company_id, lead_id, rep_id, status, revision, scheduled_at, duration_minutes, attendee_email, meeting_url, calendar_sync_status, booking_link_id")
        .eq("id", appointmentId)
        .maybeSingle();
      if (!appointment) return null;
      const [{data: lead}, {data: settings}, {data: rep}, brandName] = await Promise.all([
        client.from("leads").select("name").eq("id", appointment.lead_id).maybeSingle(),
        client.from("booking_settings").select("timezone, support_phone").eq("company_id", appointment.company_id).maybeSingle(),
        appointment.rep_id
          ? client.from("reps").select("name").eq("id", appointment.rep_id).maybeSingle()
          : Promise.resolve({data: null}),
        loadBrandName(client, appointment.company_id),
      ]);
      const manageUrl = appointment.booking_link_id
        ? await buildBookingUrl(client, configuration, appointment.company_id, appointment.booking_link_id)
        : null;
      return {
        appointmentId: appointment.id,
        status: appointment.status,
        revision: appointment.revision,
        scheduledAt: appointment.scheduled_at,
        durationMinutes: appointment.duration_minutes ?? 30,
        attendeeEmail: appointment.attendee_email,
        customerName: lead?.name ?? "there",
        meetingUrl: appointment.calendar_sync_status === "synced" ? appointment.meeting_url : null,
        manageUrl,
        timezone: settings?.timezone ?? "America/New_York",
        supportPhone: settings?.support_phone ?? null,
        brandName,
        repName: rep?.name ?? null,
      };
    },
    async send({to, fromName, subject, text, idempotencyKey}) {
      const response = await fetch(RESEND_EMAIL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({from: `${fromName} <${fromEmail}>`, to: [to], subject, text}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Resend responded with ${response.status}`);
    },
    now: () => new Date(),
  };
}

async function sendEmail(kind: BookingEmailKind, appointmentId: string, revision: number) {
  const dependencies = createEmailDependencies();
  if (!dependencies) {
    console.info("virtual_consultation_email", {kind, outcome: "not_configured"});
    return {outcome: "not_configured" as const};
  }
  const result = await sendBookingEmail({kind, appointmentId, revision}, dependencies);
  console.info("virtual_consultation_email", {kind, appointmentId, ...result});
  return result;
}

const EMAIL_KIND = {
  "appointments/virtual.booked": "confirmation",
  "appointments/virtual.rescheduled": "rescheduled",
  "appointments/virtual.cancelled": "cancelled",
} as const;

/**
 * Confirmation, reschedule and cancellation emails. Waits briefly so the
 * calendar sync can attach the Meet link, but never depends on it: a Google
 * outage still leaves the homeowner with a confirmation.
 */
export const virtualConsultationEmails = inngest.createFunction(
  {
    id: "virtual-consultation-emails",
    triggers: [
      {event: virtualConsultationBooked},
      {event: virtualConsultationRescheduled},
      {event: virtualConsultationCancelled},
    ],
    idempotency: "event.data.id",
    retries: 3,
  },
  async ({event, step}) => {
    const kind = event.name in EMAIL_KIND ? EMAIL_KIND[event.name as keyof typeof EMAIL_KIND] : null;
    if (!kind) return {outcome: "ignored" as const};
    if (kind !== "cancelled") await step.sleep("let-calendar-sync-settle", SETTLE_BEFORE_EMAIL);
    return step.run("send-email", () => sendEmail(kind, event.data.data.appointmentId, event.data.data.revision));
  },
);

/** A day-before and an hour-before reminder, pinned to the booking's revision. */
export const virtualConsultationReminders = inngest.createFunction(
  {
    id: "virtual-consultation-reminders",
    triggers: [{event: virtualConsultationBooked}, {event: virtualConsultationRescheduled}],
    idempotency: "event.data.id",
    retries: 3,
  },
  async ({event, step}) => {
    const {appointmentId, revision} = event.data.data;
    const schedule = await step.run("plan-reminders", async () => {
      const {data} = await createServiceClient()
        .from("appointments")
        .select("scheduled_at, revision")
        .eq("id", appointmentId)
        .maybeSingle();
      if (!data || data.revision !== revision) return null;
      const times = reminderTimes(data.scheduled_at, new Date(event.data.occurredAt));
      return {dayBefore: times.dayBefore?.toISOString() ?? null, hourBefore: times.hourBefore?.toISOString() ?? null};
    });
    if (!schedule) return {outcome: "stale"};

    if (schedule.dayBefore) {
      await step.sleepUntil("wait-for-day-before", new Date(schedule.dayBefore));
      await step.run("send-day-before", () => sendEmail("reminder_day", appointmentId, revision));
    }
    if (schedule.hourBefore) {
      await step.sleepUntil("wait-for-hour-before", new Date(schedule.hourBefore));
      await step.run("send-hour-before", () => sendEmail("reminder_hour", appointmentId, revision));
    }
    return {outcome: "done"};
  },
);

/** Clears booking rate-limit rows older than two days. */
export const bookingMaintenance = inngest.createFunction(
  {id: "booking-maintenance", triggers: {cron: "23 5 * * *"}},
  async () => {
    const {data, error} = await createServiceClient().rpc("prune_booking_attempts");
    if (error) throw new Error("Failed to prune booking attempts");
    return {pruned: data};
  },
);
