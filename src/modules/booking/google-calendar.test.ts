import {describe, expect, test, vi} from "vitest";
import {
  calendarEventIdFor,
  GoogleCalendarClient,
  GoogleCalendarError,
  type CalendarEventInput,
} from "./google-calendar";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
}

const staticToken = {getToken: async () => "token-1"};
const appointmentId = "11111111-1111-4111-8111-111111111111";
const input: CalendarEventInput = {
  eventId: calendarEventIdFor(appointmentId),
  appointmentId,
  summary: "Virtual roof consultation: Jordan Rivera",
  description: "Join with Google Meet.",
  start: new Date("2026-10-21T18:00:00.000Z"),
  end: new Date("2026-10-21T18:30:00.000Z"),
  timeZone: "America/New_York",
  attendees: [{email: "jordan@example.com", displayName: "Jordan Rivera"}],
  sendUpdates: "all",
};

describe("calendar client", () => {
  test("derives a valid, stable Google event ID from the appointment", () => {
    expect(calendarEventIdFor(appointmentId)).toBe("rake11111111111141118111111111111111");
    expect(calendarEventIdFor(appointmentId)).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  test("counts busy time PIW did not create, including all-day blocks", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json({
      items: [
        {status: "confirmed", start: {dateTime: "2026-10-21T13:00:00Z"}, end: {dateTime: "2026-10-21T14:00:00Z"}},
        {status: "confirmed", transparency: "transparent", start: {dateTime: "2026-10-21T15:00:00Z"}, end: {dateTime: "2026-10-21T16:00:00Z"}},
        {status: "cancelled", start: {dateTime: "2026-10-21T16:00:00Z"}, end: {dateTime: "2026-10-21T17:00:00Z"}},
        {status: "confirmed", start: {dateTime: "2026-10-21T18:00:00Z"}, end: {dateTime: "2026-10-21T18:30:00Z"},
          extendedProperties: {private: {piwAppointmentId: appointmentId}}},
        {status: "confirmed", start: {date: "2026-10-23"}, end: {date: "2026-10-24"}},
      ],
    }));
    const client = new GoogleCalendarClient(staticToken, fetchMock);
    const busy = await client.listBusy("consults@group.calendar.google.com", new Date("2026-10-20T00:00:00Z"), new Date("2026-10-27T00:00:00Z"), "America/New_York");
    expect(busy.map((interval) => [interval.start.toISOString(), interval.end.toISOString()])).toEqual([
      ["2026-10-21T13:00:00.000Z", "2026-10-21T14:00:00.000Z"],
      ["2026-10-23T04:00:00.000Z", "2026-10-24T04:00:00.000Z"],
    ]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/calendar/v3/calendars/consults%40group.calendar.google.com/events");
    expect(url.searchParams.get("singleEvents")).toBe("true");
  });

  test("inserts a new event with a Meet request and returns the link", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.id).toBe(input.eventId);
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
      expect(body.extendedProperties.private.piwAppointmentId).toBe(appointmentId);
      return json({id: input.eventId, hangoutLink: "https://meet.google.com/abc-defg-hij"});
    });
    const result = await new GoogleCalendarClient(staticToken, fetchMock).upsertEvent("cal", input, null);
    expect(result).toEqual({eventId: input.eventId, meetingUrl: "https://meet.google.com/abc-defg-hij", conferencePending: false});
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
  });

  test("turns a duplicate insert into an update instead of a second invite", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(url).pathname.split("/").at(-1)}`);
      if (init?.method === "POST") return json({error: {code: 409}}, 409);
      return json({id: input.eventId, hangoutLink: "https://meet.google.com/abc-defg-hij"});
    });
    const result = await new GoogleCalendarClient(staticToken, fetchMock).upsertEvent("cal", input, null);
    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(calls).toEqual(["POST events", `PATCH ${input.eventId}`]);
  });

  test("updates a known event and adds a Meet link only when it has none", async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? json({id: input.eventId})
        : json({id: input.eventId, conferenceData: {entryPoints: [{entryPointType: "video", uri: "https://meet.google.com/xyz"}]}});
    });
    const result = await new GoogleCalendarClient(staticToken, fetchMock).upsertEvent("cal", input, input.eventId);
    expect(result.meetingUrl).toBe("https://meet.google.com/xyz");
    expect(bodies[1]).toEqual({conferenceData: {createRequest: {requestId: `${input.eventId}-meet`, conferenceSolutionKey: {type: "hangoutsMeet"}}}});
  });

  test("starts a fresh event when the original ID cannot be restored", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(url).pathname.split("/").at(-1)}`);
      if (calls.length === 1) return json({error: {code: 409}}, 409);
      if (calls.length === 2) return new Response(null, {status: 410});
      const body = JSON.parse(String(init?.body));
      return json({id: body.id, hangoutLink: "https://meet.google.com/new"});
    });
    const result = await new GoogleCalendarClient(staticToken, fetchMock).upsertEvent("cal", input, null);
    expect(calls).toEqual(["POST events", `PATCH ${input.eventId}`, "POST events"]);
    expect(result.eventId).toMatch(new RegExp(`^${input.eventId}[a-v0-9]+$`));
    expect(result.meetingUrl).toBe("https://meet.google.com/new");
  });

  test("treats an already-deleted event as cancelled", async () => {
    const client = new GoogleCalendarClient(staticToken, async () => new Response(null, {status: 410}));
    await expect(client.cancelEvent("cal", input.eventId, "all")).resolves.toBeUndefined();
  });

  test("reports other Google failures with their status", async () => {
    const client = new GoogleCalendarClient(staticToken, async () => json({}, 403));
    await expect(client.upsertEvent("cal", input, null)).rejects.toBeInstanceOf(GoogleCalendarError);
    await expect(client.upsertEvent("cal", input, null)).rejects.toMatchObject({status: 403});
  });
});
