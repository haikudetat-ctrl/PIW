// Human-readable times for booking pages, emails and calendar files. Always
// rendered in the company's booking time zone with its abbreviation, so a
// homeowner on vacation in another zone still reads the right time.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions) {
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", options);
    formatters.set(key, value);
  }
  return value;
}

function parts(instant: Date, timeZone: string) {
  const values: Record<string, string> = {};
  const format = formatter(`full:${timeZone}`, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  for (const part of format.formatToParts(instant)) values[part.type] = part.value;
  return values;
}

/** "Tuesday, October 20 at 10:00 AM EDT" */
export function formatMeetingTime(instant: Date | string, timeZone: string) {
  const value = parts(new Date(instant), timeZone);
  return `${value.weekday}, ${value.month} ${value.day} at ${value.hour}:${value.minute} ${value.dayPeriod} ${value.timeZoneName}`;
}

/** "Tue, Oct 20, 10:00 AM" for subject lines and compact rows. */
export function formatMeetingTimeShort(instant: Date | string, timeZone: string) {
  return formatter(`short:${timeZone}`, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

/** "10:00 AM" */
export function formatClockTime(instant: Date | string, timeZone: string) {
  return formatter(`clock:${timeZone}`, {timeZone, hour: "numeric", minute: "2-digit"}).format(new Date(instant));
}

/** "EDT" or "EST" for the given moment. */
export function timeZoneAbbreviation(instant: Date | string, timeZone: string) {
  return parts(new Date(instant), timeZone).timeZoneName ?? timeZone;
}

/** "Thu, Nov 26" in the booking time zone. */
export function formatLocalDate(instant: Date | string, timeZone: string) {
  return formatter(`date:${timeZone}`, {timeZone, weekday: "short", month: "short", day: "numeric"}).format(new Date(instant));
}

/** Whole-day range for a blackout that ends at local midnight (exclusive). */
export function formatDayRange(startsAt: string, endsAt: string, timeZone: string) {
  const first = formatLocalDate(startsAt, timeZone);
  const last = formatLocalDate(new Date(new Date(endsAt).getTime() - 60_000), timeZone);
  return first === last ? first : `${first} to ${last}`;
}
