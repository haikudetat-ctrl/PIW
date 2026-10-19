// Wall-clock arithmetic for a named IANA time zone without a date library.
//
// Booking hours are stored as local minutes ("9:00 to 17:00 Eastern"), but
// appointments are instants. These helpers convert between the two through
// Intl, so daylight saving shifts are handled by the platform's tz database,
// the same one Postgres uses when it re-checks a slot.

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday, matching Postgres extract(dow). */
  weekday: number;
};

const WEEKDAYS: Record<string, number> = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Throws a RangeError for a time zone the runtime does not know. */
export function assertTimeZone(timeZone: string) {
  formatterFor(timeZone);
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday] ?? 0,
  };
}

function offsetMilliseconds(instant: Date, timeZone: string) {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export type DateKey = `${number}-${number}-${number}`;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad(month)}-${pad(day)}` as DateKey;
}

export function parseDateKey(key: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid date key: ${key}`);
  return {year: Number(match[1]), month: Number(match[2]), day: Number(match[3])};
}

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function zonedDateKey(instant: Date, timeZone: string): DateKey {
  const parts = zonedParts(instant, timeZone);
  return toDateKey(parts.year, parts.month, parts.day);
}

/** Calendar arithmetic on a local date; time zones do not matter here. */
export function addDays(key: string, days: number): DateKey {
  const {year, month, day} = parseDateKey(key);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function weekdayOfDateKey(key: string): number {
  const {year, month, day} = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The instant at which the local wall clock reads `minuteOfDay` on `dateKey`.
 * Returns null for wall times skipped by a spring-forward transition. For a
 * repeated (fall-back) wall time it returns the first occurrence.
 */
export function wallTimeToInstant(dateKey: string, minuteOfDay: number, timeZone: string): Date | null {
  const {year, month, day} = parseDateKey(dateKey);
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstOffset = offsetMilliseconds(new Date(naive), timeZone);
  let candidate = naive - firstOffset;
  const secondOffset = offsetMilliseconds(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) candidate = naive - secondOffset;

  const resolved = zonedParts(new Date(candidate), timeZone);
  const resolvedMinute = resolved.hour * 60 + resolved.minute;
  const expectedDay = new Date(naive);
  if (
    resolved.year !== expectedDay.getUTCFullYear()
    || resolved.month !== expectedDay.getUTCMonth() + 1
    || resolved.day !== expectedDay.getUTCDate()
    || resolvedMinute !== ((minuteOfDay % 1440) + 1440) % 1440
  ) {
    return null;
  }
  return new Date(candidate);
}

/**
 * Every instant at which the local wall clock reads `minuteOfDay` on
 * `dateKey`: none in a spring-forward gap, two in a fall-back overlap, one
 * otherwise. Postgres accepts any of them, so the slot engine offers each.
 */
export function wallTimeToInstants(dateKey: string, minuteOfDay: number, timeZone: string): Date[] {
  const {year, month, day} = parseDateKey(dateKey);
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const halfDay = 12 * 60 * 60_000;
  const offsets = new Set([
    offsetMilliseconds(new Date(naive - halfDay), timeZone),
    offsetMilliseconds(new Date(naive + halfDay), timeZone),
  ]);
  const expected = new Date(naive);
  const expectedMinute = ((minuteOfDay % 1440) + 1440) % 1440;
  const instants: Date[] = [];
  for (const offset of offsets) {
    const candidate = new Date(naive - offset);
    const parts = zonedParts(candidate, timeZone);
    if (
      parts.year === expected.getUTCFullYear()
      && parts.month === expected.getUTCMonth() + 1
      && parts.day === expected.getUTCDate()
      && parts.hour * 60 + parts.minute === expectedMinute
    ) {
      instants.push(candidate);
    }
  }
  return instants.sort((a, b) => a.getTime() - b.getTime());
}

/** Minutes past local midnight for an instant. */
export function zonedMinuteOfDay(instant: Date, timeZone: string) {
  const parts = zonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}
