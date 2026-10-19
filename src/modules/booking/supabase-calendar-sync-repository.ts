import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {Database} from "@/lib/database.types";
import {publicBrandSchema} from "@/modules/tenancy/public-host";
import type {CalendarSyncRepository, SyncAppointment} from "./calendar-sync";

type Client = SupabaseClient<Database>;

const statusSchema = z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]);
const meetingTypeSchema = z.enum(["in_person", "virtual"]).nullable();

/** The tenant's customer-facing name: its verified public host brand, else the company name. */
export async function loadBrandName(client: Client, companyId: string) {
  const {data: host} = await client
    .from("company_public_hosts")
    .select("brand")
    .eq("company_id", companyId)
    .not("verified_at", "is", null)
    .order("created_at", {ascending: true})
    .limit(1)
    .maybeSingle();
  const brand = publicBrandSchema.safeParse(host?.brand);
  if (brand.success) return brand.data.displayName;
  const {data: company} = await client.from("companies").select("name").eq("id", companyId).maybeSingle();
  return company?.name ?? "Your roofing team";
}

export class SupabaseCalendarSyncRepository implements CalendarSyncRepository {
  constructor(private readonly client: Client) {}

  async load(appointmentId: string): Promise<SyncAppointment | null> {
    const {data: appointment, error} = await this.client
      .from("appointments")
      .select("id, company_id, lead_id, rep_id, status, meeting_type, scheduled_at, duration_minutes, revision, attendee_email, customer_notes, calendar_event_id")
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) throw new Error("Failed to load appointment for calendar sync");
    if (!appointment) return null;

    const [{data: lead}, {data: settings}, rep, brandName] = await Promise.all([
      this.client.from("leads").select("name, submitted_address, properties(canonical_address)")
        .eq("company_id", appointment.company_id).eq("id", appointment.lead_id).maybeSingle(),
      this.client.from("booking_settings").select("google_calendar_id, timezone, meeting_title, send_calendar_invites, support_phone")
        .eq("company_id", appointment.company_id).maybeSingle(),
      appointment.rep_id
        ? this.client.from("reps").select("name, email").eq("company_id", appointment.company_id).eq("id", appointment.rep_id).maybeSingle()
          .then(({data}) => data)
        : Promise.resolve(null),
      loadBrandName(this.client, appointment.company_id),
    ]);
    if (!lead) throw new Error("Failed to load lead for calendar sync");

    const property = lead.properties as {canonical_address: string | null} | null;
    return {
      id: appointment.id,
      companyId: appointment.company_id,
      status: statusSchema.parse(appointment.status),
      meetingType: meetingTypeSchema.catch(null).parse(appointment.meeting_type),
      scheduledAt: appointment.scheduled_at,
      durationMinutes: appointment.duration_minutes ?? 30,
      revision: appointment.revision,
      customerName: lead.name,
      attendeeEmail: appointment.attendee_email,
      propertyAddress: property?.canonical_address ?? lead.submitted_address,
      customerNotes: appointment.customer_notes,
      calendarEventId: appointment.calendar_event_id,
      rep: rep ? {name: rep.name, email: rep.email} : null,
      settings: {
        googleCalendarId: settings?.google_calendar_id ?? null,
        timezone: settings?.timezone ?? "America/New_York",
        meetingTitle: settings?.meeting_title ?? "Virtual roof consultation",
        sendCalendarInvites: settings?.send_calendar_invites ?? true,
        supportPhone: settings?.support_phone ?? null,
      },
      brandName,
    };
  }

  async recordSynced(input: {appointmentId: string; revision: number; eventId: string | null; meetingUrl: string | null}) {
    const now = new Date().toISOString();
    const {data, error} = await this.client
      .from("appointments")
      .update({
        calendar_event_id: input.eventId,
        meeting_url: input.meetingUrl,
        calendar_sync_status: "synced",
        calendar_synced_revision: input.revision,
        calendar_synced_at: now,
        calendar_sync_error: null,
        updated_at: now,
      })
      .eq("id", input.appointmentId)
      .eq("revision", input.revision)
      .select("id");
    if (error) throw new Error("Failed to record calendar sync");
    return (data ?? []).length > 0;
  }

  async recordFailed(input: {appointmentId: string; revision: number; error: string}) {
    await this.client
      .from("appointments")
      .update({calendar_sync_status: "failed", calendar_sync_error: input.error, updated_at: new Date().toISOString()})
      .eq("id", input.appointmentId)
      .eq("revision", input.revision);
  }

  async recordNotConfigured(input: {appointmentId: string; revision: number}) {
    await this.client
      .from("appointments")
      .update({calendar_sync_status: "not_configured", updated_at: new Date().toISOString()})
      .eq("id", input.appointmentId)
      .eq("revision", input.revision);
  }
}
