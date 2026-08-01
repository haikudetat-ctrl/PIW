import type { CostPeriod } from "./contracts";

export const COST_TIMEZONE = "America/New_York";

function dateParts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((value) => value.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
  };
}

export function calendarMonthPeriod(
  now = new Date(),
  timezone = COST_TIMEZONE,
): CostPeriod {
  const { year, month, day, hour } = dateParts(now, timezone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const elapsedDays = Math.min(daysInMonth, Math.max(1 / 24, day - 1 + hour / 24));
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    endExclusive: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
    daysInMonth,
    elapsedDays,
    timezone,
  };
}

export function costSlotKey(now = new Date(), timezone = COST_TIMEZONE) {
  const { year, month, day, hour } = dateParts(now, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}`;
}
