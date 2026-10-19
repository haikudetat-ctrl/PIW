import {
  addDays,
  type DateKey,
  wallTimeToInstants,
  weekdayOfDateKey,
  zonedDateKey,
  zonedParts,
} from "./zoned-time";

// Proposes bookable start times. The rules mirror
// public.virtual_consultation_slot_problem in Postgres, which has the final
// say when a homeowner confirms; a slot shown here can still be refused if
// someone else took it in the meantime.

export type BookingRules = {
  timezone: string;
  meetingDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  concurrentCapacity: number;
};

export type WeeklyWindow = {
  /** 0 = Sunday. */
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type TimeInterval = {start: Date; end: Date};

export type SlotEngineInput = {
  rules: BookingRules;
  windows: readonly WeeklyWindow[];
  /** Company blackouts (holidays, offsites). Block without buffer. */
  blackouts: readonly TimeInterval[];
  /** Live virtual consultations already booked. Consume team capacity. */
  booked: readonly TimeInterval[];
  /** Busy time on the shared Google calendar. Blocks the whole team. */
  calendarBusy: readonly TimeInterval[];
  now: Date;
};

export type Slot = {startsAt: string; minuteOfDay: number};
export type DaySlots = {date: DateKey; weekday: number; slots: Slot[]};

const MINUTE = 60_000;

function overlaps(start: Date, end: Date, other: TimeInterval, paddingMs = 0) {
  return start.getTime() < other.end.getTime() + paddingMs
    && other.start.getTime() < end.getTime() + paddingMs;
}

/** Local wall-clock minute at which the meeting ends, or null if it spills past midnight. */
function endMinuteOnSameDay(end: Date, dateKey: string, timeZone: string) {
  const endParts = zonedParts(end, timeZone);
  const endKey = `${endParts.year}-${String(endParts.month).padStart(2, "0")}-${String(endParts.day).padStart(2, "0")}`;
  const endMinute = endParts.hour * 60 + endParts.minute;
  if (endKey === dateKey) return endMinute;
  if (endKey === addDays(dateKey, 1) && endMinute === 0 && endParts.second === 0) return 1440;
  return null;
}

export function computeAvailableSlots(input: SlotEngineInput): DaySlots[] {
  const {rules, windows, now} = input;
  const durationMs = rules.meetingDurationMinutes * MINUTE;
  const bufferMs = rules.bufferMinutes * MINUTE;
  const earliest = now.getTime() + rules.minimumNoticeMinutes * MINUTE;
  const latest = now.getTime() + rules.bookingHorizonDays * 24 * 60 * MINUTE;

  const firstDay = zonedDateKey(now, rules.timezone);
  const lastDay = zonedDateKey(new Date(latest), rules.timezone);
  const days: DaySlots[] = [];

  for (let date = firstDay; date <= lastDay; date = addDays(date, 1)) {
    const weekday = weekdayOfDateKey(date);
    const slots: Slot[] = [];
    const seen = new Set<number>();
    const dayWindows = windows
      .filter((window) => window.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);

    for (const window of dayWindows) {
      for (let minute = window.startMinute; minute < window.endMinute; minute += rules.slotIntervalMinutes) {
        // Usually one instant; none in a spring-forward gap, two on a fall-back night.
        for (const start of wallTimeToInstants(date, minute, rules.timezone)) {
          const startMs = start.getTime();
          if (seen.has(startMs) || startMs < earliest || startMs > latest) continue;

          const end = new Date(startMs + durationMs);
          const endMinute = endMinuteOnSameDay(end, date, rules.timezone);
          if (endMinute === null || endMinute > window.endMinute) continue;

          if (input.blackouts.some((blackout) => overlaps(start, end, blackout))) continue;
          if (input.calendarBusy.some((busy) => overlaps(start, end, busy, bufferMs))) continue;
          const taken = input.booked.filter((meeting) => overlaps(start, end, meeting, bufferMs)).length;
          if (taken >= rules.concurrentCapacity) continue;

          seen.add(startMs);
          slots.push({startsAt: start.toISOString(), minuteOfDay: minute});
        }
      }
    }

    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    days.push({date, weekday, slots});
  }

  return days;
}

/** True when the instant is one of the proposed slots. */
export function isProposedSlot(days: readonly DaySlots[], startsAt: string) {
  const target = new Date(startsAt).getTime();
  return days.some((day) => day.slots.some((slot) => new Date(slot.startsAt).getTime() === target));
}
