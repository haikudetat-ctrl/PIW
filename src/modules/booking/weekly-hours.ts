import {z} from "zod";
import type {WeeklyWindow} from "./slots";

// The settings form has one row per weekday: an "open" checkbox plus start
// and end times. Midnight as an end time means "until the end of the day".

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function minutesOf(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function toClock(minute: number) {
  const bounded = minute >= 1440 ? 0 : minute;
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

export class WeeklyHoursError extends Error {}

export function parseWeeklyHours(formData: Pick<FormData, "get">): WeeklyWindow[] {
  const windows: WeeklyWindow[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (formData.get(`day-${weekday}-open`) !== "on") continue;
    const start = clock.safeParse(formData.get(`day-${weekday}-start`));
    const end = clock.safeParse(formData.get(`day-${weekday}-end`));
    if (!start.success || !end.success) throw new WeeklyHoursError("Use a start and end time for each open day.");
    const startMinute = minutesOf(start.data);
    const endMinute = end.data === "00:00" ? 1440 : minutesOf(end.data);
    if (endMinute <= startMinute) throw new WeeklyHoursError("Each open day needs to end after it starts.");
    windows.push({weekday, startMinute, endMinute});
  }
  return windows;
}
