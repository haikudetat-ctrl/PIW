import "server-only";
import {z} from "zod";
import type {AccessTokenSource} from "./google-auth";
import type {TimeInterval} from "./slots";
import {wallTimeToInstant} from "./zoned-time";

// Google Calendar over plain fetch, acting as the delegated Workspace user
// (the owner of the shared consultations calendar), which is what lets Google
// attach a Meet link and email invites. Authentication lives in google-auth.ts.

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GoogleCalendarError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const eventTimeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
});

const listedEventSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  transparency: z.string().optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  extendedProperties: z.object({private: z.record(z.string(), z.string()).optional()}).optional(),
});

const eventListSchema = z.object({
  items: z.array(listedEventSchema).default([]),
  nextPageToken: z.string().optional(),
});

const calendarEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  hangoutLink: z.string().optional(),
  conferenceData: z.object({
    entryPoints: z.array(z.object({entryPointType: z.string(), uri: z.string()})).optional(),
    createRequest: z.object({status: z.object({statusCode: z.string()}).optional()}).optional(),
  }).optional(),
});

type CalendarEvent = z.infer<typeof calendarEventSchema>;

export type CalendarAttendee = {email: string; displayName?: string};

export type CalendarEventInput = {
  eventId: string;
  appointmentId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  attendees: CalendarAttendee[];
  sendUpdates: "all" | "none";
};

export type CalendarEventResult = {
  eventId: string;
  meetingUrl: string | null;
  conferencePending: boolean;
};

export function meetingUrlOf(event: CalendarEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
  const url = event.hangoutLink ?? video ?? null;
  return url && url.startsWith("https://") ? url : null;
}

function toResult(event: CalendarEvent): CalendarEventResult {
  return {
    eventId: event.id,
    meetingUrl: meetingUrlOf(event),
    conferencePending: event.conferenceData?.createRequest?.status?.statusCode === "pending",
  };
}

/**
 * Google event IDs allow base32hex characters (a-v, 0-9). Deriving the ID
 * from the appointment makes the insert idempotent: a retried insert returns
 * 409 and becomes an update instead of a second invite.
 */
export function calendarEventIdFor(appointmentId: string) {
  const hex = z.uuid().parse(appointmentId).replaceAll("-", "").toLowerCase();
  return `rake${hex}`;
}

function eventBody(input: CalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: {dateTime: input.start.toISOString(), timeZone: input.timeZone},
    end: {dateTime: input.end.toISOString(), timeZone: input.timeZone},
    attendees: input.attendees,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    status: "confirmed",
    extendedProperties: {private: {piwAppointmentId: input.appointmentId}},
  };
}

function meetRequest(eventId: string) {
  return {createRequest: {requestId: `${eventId}-meet`, conferenceSolutionKey: {type: "hangoutsMeet"}}};
}

export class GoogleCalendarClient {
  constructor(
    private readonly tokens: AccessTokenSource,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request(path: string, init: RequestInit & {query?: Record<string, string>} = {}) {
    const url = new URL(`${CALENDAR_API}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const token = await this.tokens.getToken();
    return this.fetchImpl(url.toString(), {
      method: init.method ?? "GET",
      headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private eventsPath(calendarId: string, eventId?: string) {
    const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  /**
   * Busy time on the shared calendar that PIW did not create: holidays,
   * training, anything a manager blocks by hand. PIW's own events are
   * counted from the database instead, so they are skipped here.
   */
  async listBusy(calendarId: string, timeMin: Date, timeMax: Date, timeZone: string): Promise<TimeInterval[]> {
    const busy: TimeInterval[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const response = await this.request(this.eventsPath(calendarId), {
        query: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: "true",
          showDeleted: "false",
          maxResults: "250",
          fields: "items(id,status,transparency,start,end,extendedProperties/private),nextPageToken",
          ...(pageToken ? {pageToken} : {}),
        },
      });
      if (!response.ok) {
        throw new GoogleCalendarError(`Google Calendar list failed with ${response.status}`, response.status);
      }
      const parsed = eventListSchema.safeParse(await response.json());
      if (!parsed.success) throw new GoogleCalendarError("Google Calendar list was malformed", 502);
      for (const item of parsed.data.items) {
        if (item.status === "cancelled" || item.transparency === "transparent") continue;
        if (item.extendedProperties?.private?.piwAppointmentId) continue;
        const interval = toInterval(item.start, item.end, timeZone);
        if (interval) busy.push(interval);
      }
      pageToken = parsed.data.nextPageToken;
      if (!pageToken) break;
    }
    return busy;
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEventResult | null> {
    const response = await this.request(this.eventsPath(calendarId, eventId));
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new GoogleCalendarError(`Google Calendar read failed with ${response.status}`, response.status);
    const event = calendarEventSchema.parse(await response.json());
    return event.status === "cancelled" ? null : toResult(event);
  }

  /** Creates the event with a Meet link, or brings an existing one up to date. */
  async upsertEvent(calendarId: string, input: CalendarEventInput, knownEventId: string | null): Promise<CalendarEventResult> {
    if (knownEventId) {
      const patched = await this.patchEvent(calendarId, knownEventId, input);
      if (patched) return patched;
    }
    const insert = await this.request(this.eventsPath(calendarId), {
      method: "POST",
      query: {conferenceDataVersion: "1", sendUpdates: input.sendUpdates},
      body: JSON.stringify({id: input.eventId, ...eventBody(input), conferenceData: meetRequest(input.eventId)}),
    });
    if (insert.ok) return toResult(calendarEventSchema.parse(await insert.json()));
    if (insert.status !== 409) {
      throw new GoogleCalendarError(`Google Calendar insert failed with ${insert.status}`, insert.status);
    }
    // The ID already exists: a retried insert, or an event someone deleted.
    // Patching restores it and fills in the Meet link if it never got one.
    const restored = await this.patchEvent(calendarId, input.eventId, input);
    if (restored) return restored;
    // Google keeps the ID of a purged event reserved. Start a fresh event
    // under a new ID; the caller stores whichever ID comes back.
    const freshId = `${input.eventId}${Date.now().toString(32)}`;
    const fresh = await this.request(this.eventsPath(calendarId), {
      method: "POST",
      query: {conferenceDataVersion: "1", sendUpdates: input.sendUpdates},
      body: JSON.stringify({id: freshId, ...eventBody(input), conferenceData: meetRequest(freshId)}),
    });
    if (!fresh.ok) throw new GoogleCalendarError(`Google Calendar insert failed with ${fresh.status}`, fresh.status);
    return toResult(calendarEventSchema.parse(await fresh.json()));
  }

  private async patchEvent(calendarId: string, eventId: string, input: CalendarEventInput) {
    const response = await this.request(this.eventsPath(calendarId, eventId), {
      method: "PATCH",
      query: {conferenceDataVersion: "1", sendUpdates: input.sendUpdates},
      body: JSON.stringify(eventBody(input)),
    });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new GoogleCalendarError(`Google Calendar update failed with ${response.status}`, response.status);
    let event = calendarEventSchema.parse(await response.json());
    const conferencePending = event.conferenceData?.createRequest?.status?.statusCode === "pending";
    if (!meetingUrlOf(event) && !conferencePending) {
      const withMeet = await this.request(this.eventsPath(calendarId, eventId), {
        method: "PATCH",
        query: {conferenceDataVersion: "1", sendUpdates: "none"},
        body: JSON.stringify({conferenceData: meetRequest(eventId)}),
      });
      if (!withMeet.ok) {
        throw new GoogleCalendarError(`Google Meet link request failed with ${withMeet.status}`, withMeet.status);
      }
      event = calendarEventSchema.parse(await withMeet.json());
    }
    return toResult(event);
  }

  /** Cancels the event and notifies attendees. Already-gone events are fine. */
  async cancelEvent(calendarId: string, eventId: string, sendUpdates: "all" | "none") {
    const response = await this.request(this.eventsPath(calendarId, eventId), {
      method: "DELETE",
      query: {sendUpdates},
    });
    if (response.ok || response.status === 404 || response.status === 410) return;
    throw new GoogleCalendarError(`Google Calendar cancel failed with ${response.status}`, response.status);
  }
}

function toInterval(
  start: z.infer<typeof eventTimeSchema> | undefined,
  end: z.infer<typeof eventTimeSchema> | undefined,
  timeZone: string,
): TimeInterval | null {
  if (start?.dateTime && end?.dateTime) {
    const interval = {start: new Date(start.dateTime), end: new Date(end.dateTime)};
    return Number.isFinite(interval.start.getTime()) && Number.isFinite(interval.end.getTime()) ? interval : null;
  }
  // All-day events: local midnight to local midnight on the end date (exclusive).
  if (start?.date && end?.date) {
    const from = wallTimeToInstant(start.date, 0, timeZone);
    const to = wallTimeToInstant(end.date, 0, timeZone);
    return from && to ? {start: from, end: to} : null;
  }
  return null;
}
