"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCalendarId } from "@/modules/booking/calendar-id";
import { parseWeeklyHours, WeeklyHoursError } from "@/modules/booking/weekly-hours";
import { addDays, wallTimeToInstant } from "@/modules/booking/zoned-time";

export type BookingSettingsFormState = { ok: boolean; message: string } | null;

async function requireCompanyAdmin() {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(data);
  if (!access || !hasRole(access, "company_admin")) throw new Error("Company admin access required");
  return access;
}

const optionalText = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().optional());

const settingsSchema = z.object({
  isEnabled: z.boolean(),
  googleCalendarId: optionalText.pipe(z.string().max(320).optional()),
  meetingTitle: z.string().trim().min(1).max(120),
  meetingDurationMinutes: z.coerce.number().int().min(15).max(120),
  slotIntervalMinutes: z.coerce.number().int().refine((value) => [15, 20, 30, 45, 60].includes(value)),
  bufferMinutes: z.coerce.number().int().min(0).max(60),
  minimumNoticeHours: z.coerce.number().min(0).max(168),
  bookingHorizonDays: z.coerce.number().int().min(1).max(60),
  concurrentCapacity: z.coerce.number().int().min(1).max(20),
  sendCalendarInvites: z.boolean(),
  supportPhone: optionalText.pipe(z.string().min(7).max(40).optional()),
});

export async function saveBookingSettings(
  _previous: BookingSettingsFormState,
  formData: FormData,
): Promise<BookingSettingsFormState> {
  const access = await requireCompanyAdmin();
  const parsed = settingsSchema.safeParse({
    isEnabled: formData.get("isEnabled") === "on",
    googleCalendarId: formData.get("googleCalendarId"),
    meetingTitle: formData.get("meetingTitle"),
    meetingDurationMinutes: formData.get("meetingDurationMinutes"),
    slotIntervalMinutes: formData.get("slotIntervalMinutes"),
    bufferMinutes: formData.get("bufferMinutes"),
    minimumNoticeHours: formData.get("minimumNoticeHours"),
    bookingHorizonDays: formData.get("bookingHorizonDays"),
    concurrentCapacity: formData.get("concurrentCapacity"),
    sendCalendarInvites: formData.get("sendCalendarInvites") === "on",
    supportPhone: formData.get("supportPhone"),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted values and try again." };

  const googleCalendarId =
    parsed.data.googleCalendarId === undefined ? undefined : normalizeCalendarId(parsed.data.googleCalendarId);
  if (googleCalendarId === null) {
    return {
      ok: false,
      message:
        "That doesn't look like a Google Calendar ID. In Google Calendar, open the calendar's settings and copy the Calendar ID under Integrate calendar.",
    };
  }

  let windows;
  try {
    windows = parseWeeklyHours(formData);
  } catch (error) {
    if (error instanceof WeeklyHoursError) return { ok: false, message: error.message };
    throw error;
  }

  const service = createServiceClient();
  const { data: existing } = await service
    .from("booking_settings")
    .select("timezone")
    .eq("company_id", access.companyId)
    .maybeSingle();
  const { minimumNoticeHours, ...settings } = parsed.data;
  const { error } = await service.rpc("save_booking_settings", {
    p_company_id: access.companyId,
    p_settings: {
      ...settings,
      googleCalendarId,
      timezone: existing?.timezone ?? "America/New_York",
      minimumNoticeMinutes: Math.round(minimumNoticeHours * 60),
    },
    p_windows: windows,
    p_updated_by: access.userId,
  });
  if (error) {
    const known = [
      "Add the Google Calendar ID before turning on booking",
      "Add weekly hours before turning on booking",
      "Weekly hours overlap",
    ];
    return { ok: false, message: known.includes(error.message) ? error.message : "Couldn't save booking settings." };
  }
  revalidatePath("/settings/booking");
  revalidatePath("/appointments");
  return { ok: true, message: "Saved." };
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Blocks whole days (holidays, offsites). Partial blocks go on the shared Google calendar. */
export async function addBlackout(formData: FormData) {
  const access = await requireCompanyAdmin();
  const input = z.object({ from: dateKey, to: dateKey, reason: optionalText.pipe(z.string().max(200).optional()) }).parse({
    from: formData.get("from"),
    to: formData.get("to") || formData.get("from"),
    reason: formData.get("reason"),
  });
  if (input.to < input.from) throw new Error("The blackout must end on or after its first day");
  const service = createServiceClient();
  const { data: settings } = await service.from("booking_settings").select("timezone").eq("company_id", access.companyId).maybeSingle();
  if (!settings) throw new Error("Save booking settings before adding blackouts");
  const startsAt = wallTimeToInstant(input.from, 0, settings.timezone);
  const endsAt = wallTimeToInstant(addDays(input.to, 1), 0, settings.timezone);
  if (!startsAt || !endsAt) throw new Error("Invalid blackout dates");
  const { error } = await service.from("booking_blackouts").insert({
    company_id: access.companyId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: input.reason ?? null,
    created_by: access.userId,
  });
  if (error) throw new Error("Failed to add the blackout");
  revalidatePath("/settings/booking");
}

export async function removeBlackout(formData: FormData) {
  const access = await requireCompanyAdmin();
  const id = z.uuid().parse(formData.get("blackoutId"));
  const { error } = await createServiceClient()
    .from("booking_blackouts")
    .delete()
    .eq("company_id", access.companyId)
    .eq("id", id);
  if (error) throw new Error("Failed to remove the blackout");
  revalidatePath("/settings/booking");
}

const repSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: optionalText.pipe(z.email().max(254).optional()),
});

export async function addRep(formData: FormData) {
  const access = await requireCompanyAdmin();
  const input = repSchema.parse({ name: formData.get("name"), email: formData.get("email") });
  const { error } = await createServiceClient().from("reps").insert({
    company_id: access.companyId,
    name: input.name,
    email: input.email?.toLowerCase() ?? null,
  });
  if (error) throw new Error("Failed to add the rep");
  revalidatePath("/settings/booking");
  revalidatePath("/appointments");
}

export async function updateRep(formData: FormData) {
  const access = await requireCompanyAdmin();
  const input = repSchema.extend({ repId: z.uuid(), isActive: z.boolean() }).parse({
    repId: formData.get("repId"),
    name: formData.get("name"),
    email: formData.get("email"),
    isActive: formData.get("isActive") === "on",
  });
  const { error } = await createServiceClient()
    .from("reps")
    .update({
      name: input.name,
      email: input.email?.toLowerCase() ?? null,
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", access.companyId)
    .eq("id", input.repId);
  if (error) throw new Error("Failed to update the rep");
  revalidatePath("/settings/booking");
  revalidatePath("/appointments");
}
