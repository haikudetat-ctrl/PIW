import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {eventEnvelopeSchema} from "@/domain/events";
import type {Database} from "@/lib/database.types";
import {
  BookingLinkExpiredError,
  BookingLinkMissingError,
  BookingRateLimitError,
  type ActiveBooking,
  type BookingLinkRecord,
  type BookingRepository,
  type CompanyBookingSettings,
} from "./booking-service";
import type {TimeInterval, WeeklyWindow} from "./slots";

type Client = SupabaseClient<Database>;

const rpcRowSchema = z.object({
  outcome: z.string(),
  problem: z.string().nullable().optional(),
  appointment_id: z.uuid().nullable(),
  event: z.unknown().nullable(),
});

function raiseFor(error: {message?: string} | null) {
  if (!error) return;
  switch (error.message) {
    case "Booking rate limit exceeded":
      throw new BookingRateLimitError();
    case "Booking link expired":
      throw new BookingLinkExpiredError();
    case "Booking link not found":
      throw new BookingLinkMissingError();
    default:
      throw new Error("Booking persistence failed");
  }
}

function parseOutcome(data: unknown) {
  const parsed = z.array(rpcRowSchema).length(1).safeParse(data);
  if (!parsed.success) throw new Error("Booking persistence returned an unexpected shape");
  const row = parsed.data[0];
  return {
    outcome: row.outcome,
    problem: row.problem ?? null,
    appointmentId: row.appointment_id,
    event: row.event === null ? null : eventEnvelopeSchema.parse(row.event),
  };
}

export class SupabaseBookingRepository implements BookingRepository {
  constructor(private readonly client: Client) {}

  async findLink(linkId: string): Promise<BookingLinkRecord | null> {
    const {data, error} = await this.client
      .from("booking_links")
      .select("id, company_id, lead_id, expires_at, revoked_at")
      .eq("id", linkId)
      .maybeSingle();
    if (error) throw new Error("Failed to load booking link");
    return data
      ? {id: data.id, companyId: data.company_id, leadId: data.lead_id, expiresAt: data.expires_at, revokedAt: data.revoked_at}
      : null;
  }

  async touchLink(linkId: string, now: Date) {
    await this.client.from("booking_links").update({last_opened_at: now.toISOString()}).eq("id", linkId);
  }

  async loadLead(companyId: string, leadId: string) {
    const {data, error} = await this.client
      .from("leads")
      .select("name, email")
      .eq("company_id", companyId)
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw new Error("Failed to load lead for booking");
    return data;
  }

  async loadSettings(companyId: string): Promise<CompanyBookingSettings | null> {
    const {data, error} = await this.client
      .from("booking_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error("Failed to load booking settings");
    if (!data) return null;
    return {
      companyId: data.company_id,
      isEnabled: data.is_enabled,
      timezone: data.timezone,
      meetingTitle: data.meeting_title,
      meetingDurationMinutes: data.meeting_duration_minutes,
      slotIntervalMinutes: data.slot_interval_minutes,
      bufferMinutes: data.buffer_minutes,
      minimumNoticeMinutes: data.minimum_notice_minutes,
      bookingHorizonDays: data.booking_horizon_days,
      concurrentCapacity: data.concurrent_capacity,
      googleCalendarId: data.google_calendar_id,
      sendCalendarInvites: data.send_calendar_invites,
      supportPhone: data.support_phone,
    };
  }

  async loadWindows(companyId: string): Promise<WeeklyWindow[]> {
    const {data, error} = await this.client
      .from("booking_availability_windows")
      .select("weekday, start_minute, end_minute")
      .eq("company_id", companyId);
    if (error) throw new Error("Failed to load booking hours");
    return (data ?? []).map((row) => ({weekday: row.weekday, startMinute: row.start_minute, endMinute: row.end_minute}));
  }

  async loadBlackouts(companyId: string, from: Date, to: Date): Promise<TimeInterval[]> {
    const {data, error} = await this.client
      .from("booking_blackouts")
      .select("starts_at, ends_at")
      .eq("company_id", companyId)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString());
    if (error) throw new Error("Failed to load booking blackouts");
    return (data ?? []).map((row) => ({start: new Date(row.starts_at), end: new Date(row.ends_at)}));
  }

  async loadBookedIntervals(companyId: string, from: Date, to: Date, excludeAppointmentId: string | null): Promise<TimeInterval[]> {
    let query = this.client
      .from("appointments")
      .select("id, scheduled_at, duration_minutes")
      .eq("company_id", companyId)
      .eq("meeting_type", "virtual")
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", new Date(from.getTime() - 4 * 60 * 60_000).toISOString())
      .lt("scheduled_at", to.toISOString());
    if (excludeAppointmentId) query = query.neq("id", excludeAppointmentId);
    const {data, error} = await query;
    if (error) throw new Error("Failed to load booked consultations");
    return (data ?? []).map((row) => {
      const start = new Date(row.scheduled_at);
      return {start, end: new Date(start.getTime() + (row.duration_minutes ?? 30) * 60_000)};
    });
  }

  async findActiveBooking(companyId: string, leadId: string): Promise<ActiveBooking | null> {
    const {data, error} = await this.client
      .from("appointments")
      .select("id, scheduled_at, duration_minutes, meeting_url, calendar_sync_status, attendee_email, revision")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .eq("booking_source", "self_service")
      .in("status", ["scheduled", "confirmed"])
      .maybeSingle();
    if (error) throw new Error("Failed to load booking");
    if (!data) return null;
    const status = z.enum(["pending", "synced", "failed", "not_configured"]).catch("pending").parse(data.calendar_sync_status);
    return {
      id: data.id,
      scheduledAt: data.scheduled_at,
      durationMinutes: data.duration_minutes ?? 30,
      meetingUrl: data.meeting_url,
      calendarSyncStatus: status,
      attendeeEmail: data.attendee_email,
      revision: data.revision,
    };
  }

  async book(input: {linkId: string; startsAt: string; attendeeEmail: string | null; notes: string | null; requestIp: string}) {
    const {data, error} = await this.client.rpc("book_virtual_consultation", {
      p_link_id: input.linkId,
      p_starts_at: input.startsAt,
      p_attendee_email: input.attendeeEmail as string,
      p_customer_notes: input.notes as string,
      p_request_ip: input.requestIp,
    });
    raiseFor(error);
    return parseOutcome(data);
  }

  async reschedule(input: {linkId: string; startsAt: string; requestIp: string}) {
    const {data, error} = await this.client.rpc("reschedule_virtual_consultation", {
      p_link_id: input.linkId,
      p_starts_at: input.startsAt,
      p_request_ip: input.requestIp,
    });
    raiseFor(error);
    return parseOutcome(data);
  }

  async cancel(input: {linkId: string; requestIp: string}) {
    const {data, error} = await this.client.rpc("cancel_virtual_consultation", {
      p_link_id: input.linkId,
      p_request_ip: input.requestIp,
    });
    raiseFor(error);
    const parsed = z.array(z.object({
      outcome: z.string(),
      appointment_id: z.uuid().nullable(),
      event: z.unknown().nullable(),
    })).length(1).safeParse(data);
    if (!parsed.success) throw new Error("Booking persistence returned an unexpected shape");
    const row = parsed.data[0];
    return {
      outcome: row.outcome,
      problem: null,
      appointmentId: row.appointment_id,
      event: row.event === null ? null : eventEnvelopeSchema.parse(row.event),
    };
  }
}
