import {z} from "zod";
import type {DomainEvent} from "@/domain/events";
import {computeAvailableSlots, isProposedSlot, type BookingRules, type DaySlots, type TimeInterval, type WeeklyWindow} from "./slots";

// Application logic for the homeowner booking page. Everything here is
// token-scoped: the signed link resolves to one lead, and nothing a request
// body says can point it at another. Responses carry only what the page
// needs; the lead's email is masked and their phone never leaves the server.

export type CompanyBookingSettings = BookingRules & {
  companyId: string;
  isEnabled: boolean;
  googleCalendarId: string | null;
  meetingTitle: string;
  sendCalendarInvites: boolean;
  supportPhone: string | null;
};

export type BookingLinkRecord = {
  id: string;
  companyId: string;
  leadId: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type ActiveBooking = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  calendarSyncStatus: "pending" | "synced" | "failed" | "not_configured";
  attendeeEmail: string | null;
  revision: number;
};

type RpcOutcome = {
  outcome: string;
  problem: string | null;
  appointmentId: string | null;
  event: DomainEvent | null;
};

export interface BookingRepository {
  findLink(linkId: string): Promise<BookingLinkRecord | null>;
  touchLink(linkId: string, now: Date): Promise<void>;
  loadLead(companyId: string, leadId: string): Promise<{name: string; email: string} | null>;
  loadSettings(companyId: string): Promise<CompanyBookingSettings | null>;
  loadWindows(companyId: string): Promise<WeeklyWindow[]>;
  loadBlackouts(companyId: string, from: Date, to: Date): Promise<TimeInterval[]>;
  loadBookedIntervals(companyId: string, from: Date, to: Date, excludeAppointmentId: string | null): Promise<TimeInterval[]>;
  findActiveBooking(companyId: string, leadId: string): Promise<ActiveBooking | null>;
  book(input: {linkId: string; startsAt: string; attendeeEmail: string | null; notes: string | null; requestIp: string}): Promise<RpcOutcome>;
  reschedule(input: {linkId: string; startsAt: string; requestIp: string}): Promise<RpcOutcome>;
  cancel(input: {linkId: string; requestIp: string}): Promise<RpcOutcome>;
}

export interface CalendarBusySource {
  listBusy(calendarId: string, from: Date, to: Date, timeZone: string): Promise<TimeInterval[]>;
}

export type BookingDependencies = {
  repository: BookingRepository;
  calendar: CalendarBusySource;
  verifyToken(token: string): string | null;
  publish(event: DomainEvent, companyId: string): Promise<void>;
  now(): Date;
  logError?(message: string, context: Record<string, unknown>): void;
};

export class BookingRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 410 | 429 | 503,
    readonly code: string,
  ) {
    super(message);
  }
}

export class BookingRateLimitError extends Error {}
export class BookingLinkExpiredError extends Error {}
export class BookingLinkMissingError extends Error {}

export type BookingSummary = {
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  calendarReady: boolean;
  inviteEmail: string | null;
  canChange: boolean;
};

export type BookingPageModel =
  | {kind: "invalid"}
  | {kind: "expired"; supportPhone: string | null}
  | {kind: "unavailable"; supportPhone: string | null; reason: "disabled" | "calendar"}
  | {
      kind: "open" | "booked";
      firstName: string;
      inviteEmail: string;
      supportPhone: string | null;
      meetingTitle: string;
      durationMinutes: number;
      timezone: string;
      days: DaySlots[];
      booking: BookingSummary | null;
    };

/** "jordan@example.com" becomes "j•••@example.com". */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return null;
  return `${local[0]}•••@${domain}`;
}

export function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function summarize(booking: ActiveBooking, now: Date): BookingSummary {
  const start = new Date(booking.scheduledAt);
  return {
    appointmentId: booking.id,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + booking.durationMinutes * 60_000).toISOString(),
    durationMinutes: booking.durationMinutes,
    meetingUrl: booking.calendarSyncStatus === "synced" ? booking.meetingUrl : null,
    calendarReady: booking.calendarSyncStatus === "synced" && Boolean(booking.meetingUrl),
    inviteEmail: maskEmail(booking.attendeeEmail),
    canChange: start.getTime() > now.getTime(),
  };
}

type ResolvedLink = {
  link: BookingLinkRecord;
  settings: CompanyBookingSettings;
};

async function resolveLink(token: string, dependencies: BookingDependencies): Promise<ResolvedLink> {
  const linkId = dependencies.verifyToken(token);
  if (!linkId) throw new BookingRequestError("Booking link not found", 404, "not_found");
  const link = await dependencies.repository.findLink(linkId);
  if (!link || link.revokedAt) throw new BookingRequestError("Booking link not found", 404, "not_found");
  if (new Date(link.expiresAt).getTime() <= dependencies.now().getTime()) {
    throw new BookingRequestError("This booking link has expired", 410, "expired");
  }
  const settings = await dependencies.repository.loadSettings(link.companyId);
  if (!settings?.isEnabled || !settings.googleCalendarId) {
    throw new BookingRequestError("Online booking is not available right now", 503, "disabled");
  }
  return {link, settings};
}

async function computeSlots(
  resolved: ResolvedLink,
  dependencies: BookingDependencies,
  excludeAppointmentId: string | null,
): Promise<DaySlots[]> {
  const {settings} = resolved;
  const now = dependencies.now();
  const from = new Date(now.getTime() - 2 * 60 * 60_000);
  const to = new Date(now.getTime() + (settings.bookingHorizonDays + 1) * 24 * 60 * 60_000);
  const [windows, blackouts, booked] = await Promise.all([
    dependencies.repository.loadWindows(settings.companyId),
    dependencies.repository.loadBlackouts(settings.companyId, from, to),
    dependencies.repository.loadBookedIntervals(settings.companyId, from, to, excludeAppointmentId),
  ]);
  let calendarBusy: TimeInterval[];
  try {
    calendarBusy = await dependencies.calendar.listBusy(settings.googleCalendarId!, from, to, settings.timezone);
  } catch (error) {
    dependencies.logError?.("booking_calendar_busy_failed", {
      companyId: settings.companyId,
      error: error instanceof Error ? error.message : "unknown",
    });
    // Fail closed: without the shared calendar PIW could book over a block.
    throw new BookingRequestError("Online booking is temporarily unavailable", 503, "calendar");
  }
  return computeAvailableSlots({rules: settings, windows, blackouts, booked, calendarBusy, now});
}

export async function loadBookingPage(token: string, dependencies: BookingDependencies): Promise<BookingPageModel> {
  let resolved: ResolvedLink;
  try {
    resolved = await resolveLink(token, dependencies);
  } catch (error) {
    if (!(error instanceof BookingRequestError)) throw error;
    if (error.code === "not_found") return {kind: "invalid"};
    const linkId = dependencies.verifyToken(token);
    const link = linkId ? await dependencies.repository.findLink(linkId) : null;
    const settings = link ? await dependencies.repository.loadSettings(link.companyId) : null;
    const supportPhone = settings?.supportPhone ?? null;
    return error.code === "expired"
      ? {kind: "expired", supportPhone}
      : {kind: "unavailable", supportPhone, reason: "disabled"};
  }

  const {link, settings} = resolved;
  const now = dependencies.now();
  const [lead, booking] = await Promise.all([
    dependencies.repository.loadLead(link.companyId, link.leadId),
    dependencies.repository.findActiveBooking(link.companyId, link.leadId),
    dependencies.repository.touchLink(link.id, now).catch(() => undefined),
  ]);
  if (!lead) return {kind: "invalid"};

  let days: DaySlots[];
  try {
    days = await computeSlots(resolved, dependencies, booking?.id ?? null);
  } catch (error) {
    if (!(error instanceof BookingRequestError)) throw error;
    if (!booking) return {kind: "unavailable", supportPhone: settings.supportPhone, reason: "calendar"};
    days = [];
  }

  return {
    kind: booking ? "booked" : "open",
    firstName: firstNameOf(lead.name),
    inviteEmail: maskEmail(lead.email) ?? "your email",
    supportPhone: settings.supportPhone,
    meetingTitle: settings.meetingTitle,
    durationMinutes: settings.meetingDurationMinutes,
    timezone: settings.timezone,
    days,
    booking: booking ? summarize(booking, now) : null,
  };
}

export async function listSlots(token: string, dependencies: BookingDependencies) {
  const resolved = await resolveLink(token, dependencies);
  const booking = await dependencies.repository.findActiveBooking(resolved.link.companyId, resolved.link.leadId);
  return {timezone: resolved.settings.timezone, days: await computeSlots(resolved, dependencies, booking?.id ?? null)};
}

const startsAtSchema = z.iso.datetime({offset: true});
const bookSchema = z.object({
  startsAt: startsAtSchema,
  attendeeEmail: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.email().max(254).optional(),
  ),
  notes: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(1000).optional(),
  ),
}).strict();
const rescheduleSchema = z.object({startsAt: startsAtSchema}).strict();

function mapRepositoryError(error: unknown): never {
  if (error instanceof BookingRateLimitError) {
    throw new BookingRequestError("Too many changes. Please try again in an hour.", 429, "rate_limited");
  }
  if (error instanceof BookingLinkExpiredError) {
    throw new BookingRequestError("This booking link has expired", 410, "expired");
  }
  if (error instanceof BookingLinkMissingError) {
    throw new BookingRequestError("Booking link not found", 404, "not_found");
  }
  if (error instanceof BookingRequestError) throw error;
  throw new BookingRequestError("Online booking is temporarily unavailable", 503, "unavailable");
}

async function publishQuietly(event: DomainEvent | null, companyId: string, dependencies: BookingDependencies) {
  if (!event) return;
  try {
    await dependencies.publish(event, companyId);
  } catch (error) {
    // The event is already in the outbox; the cron relay will deliver it.
    dependencies.logError?.("booking_event_publish_deferred", {
      eventId: event.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function currentSummary(resolved: ResolvedLink, dependencies: BookingDependencies) {
  const booking = await dependencies.repository.findActiveBooking(resolved.link.companyId, resolved.link.leadId);
  if (!booking) throw new BookingRequestError("No upcoming consultation was found", 404, "no_booking");
  return summarize(booking, dependencies.now());
}

function assertProposed(days: DaySlots[], startsAt: string) {
  if (!isProposedSlot(days, startsAt)) {
    throw new BookingRequestError("That time was just taken. Please pick another.", 409, "slot_unavailable");
  }
}

export async function bookConsultation(
  token: string,
  body: unknown,
  requestIp: string,
  dependencies: BookingDependencies,
): Promise<BookingSummary> {
  const parsed = bookSchema.safeParse(body);
  if (!parsed.success) throw new BookingRequestError("Choose a time and check your email address", 400, "invalid");
  const resolved = await resolveLink(token, dependencies);

  const existing = await dependencies.repository.findActiveBooking(resolved.link.companyId, resolved.link.leadId);
  if (existing) throw new BookingRequestError("You already have a consultation booked", 409, "already_booked");
  assertProposed(await computeSlots(resolved, dependencies, null), parsed.data.startsAt);

  let result: RpcOutcome;
  try {
    result = await dependencies.repository.book({
      linkId: resolved.link.id,
      startsAt: new Date(parsed.data.startsAt).toISOString(),
      attendeeEmail: parsed.data.attendeeEmail ?? null,
      notes: parsed.data.notes ?? null,
      requestIp,
    });
  } catch (error) {
    mapRepositoryError(error);
  }
  if (result.outcome === "already_booked") {
    throw new BookingRequestError("You already have a consultation booked", 409, "already_booked");
  }
  if (result.outcome !== "booked") {
    throw new BookingRequestError("That time was just taken. Please pick another.", 409, "slot_unavailable");
  }
  await publishQuietly(result.event, resolved.link.companyId, dependencies);
  return currentSummary(resolved, dependencies);
}

export async function rescheduleConsultation(
  token: string,
  body: unknown,
  requestIp: string,
  dependencies: BookingDependencies,
): Promise<BookingSummary> {
  const parsed = rescheduleSchema.safeParse(body);
  if (!parsed.success) throw new BookingRequestError("Choose a new time", 400, "invalid");
  const resolved = await resolveLink(token, dependencies);
  const existing = await dependencies.repository.findActiveBooking(resolved.link.companyId, resolved.link.leadId);
  if (!existing) throw new BookingRequestError("No upcoming consultation was found", 404, "no_booking");
  assertProposed(await computeSlots(resolved, dependencies, existing.id), parsed.data.startsAt);

  let result: RpcOutcome;
  try {
    result = await dependencies.repository.reschedule({
      linkId: resolved.link.id,
      startsAt: new Date(parsed.data.startsAt).toISOString(),
      requestIp,
    });
  } catch (error) {
    mapRepositoryError(error);
  }
  switch (result.outcome) {
    case "rescheduled":
      await publishQuietly(result.event, resolved.link.companyId, dependencies);
      return currentSummary(resolved, dependencies);
    case "unchanged":
      return currentSummary(resolved, dependencies);
    case "too_late":
      throw new BookingRequestError("This consultation has already started", 409, "too_late");
    case "limit_reached":
      throw new BookingRequestError("This consultation has been moved too many times. Please call us.", 409, "limit_reached");
    case "not_found":
      throw new BookingRequestError("No upcoming consultation was found", 404, "no_booking");
    default:
      throw new BookingRequestError("That time was just taken. Please pick another.", 409, "slot_unavailable");
  }
}

export async function cancelConsultation(
  token: string,
  requestIp: string,
  dependencies: BookingDependencies,
): Promise<{cancelled: true}> {
  const resolved = await resolveLink(token, dependencies);
  let result: RpcOutcome;
  try {
    result = await dependencies.repository.cancel({linkId: resolved.link.id, requestIp});
  } catch (error) {
    mapRepositoryError(error);
  }
  if (result.outcome === "too_late") {
    throw new BookingRequestError("This consultation has already started", 409, "too_late");
  }
  if (result.outcome !== "cancelled") {
    throw new BookingRequestError("No upcoming consultation was found", 404, "no_booking");
  }
  await publishQuietly(result.event, resolved.link.companyId, dependencies);
  return {cancelled: true};
}

/** Loads the live booking for the calendar file download. */
export async function loadBookingForCalendarFile(token: string, dependencies: BookingDependencies) {
  const resolved = await resolveLink(token, dependencies);
  return {summary: await currentSummary(resolved, dependencies), settings: resolved.settings};
}
