import {NextResponse} from "next/server";
import {z} from "zod";
import {addDays, wallTimeToInstant, zonedDateKey, zonedMinuteOfDay} from "@/modules/booking/zoned-time";
import {callWindows, type CallWindow} from "./types";

export {callWindows, type CallWindow};

/** Eastern business windows, in minutes past midnight. */
const WINDOW_MINUTES: Record<Exclude<CallWindow, "asap">, readonly [number, number]> = {
  morning: [9 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 20 * 60],
};

/**
 * When the callback task is due: now for "as soon as possible" or while the
 * window is open, otherwise the window's next opening. Staff sort and filter
 * by it; it is not a promise to the homeowner.
 */
export function callbackDueAt(window: CallWindow, now: Date, timeZone = "America/New_York"): Date {
  if (window === "asap") return now;
  const [start, end] = WINDOW_MINUTES[window];
  const today = zonedDateKey(now, timeZone);
  const minute = zonedMinuteOfDay(now, timeZone);
  if (minute >= start && minute < end) return now;
  const day = minute < start ? today : addDays(today, 1);
  return wallTimeToInstant(day, start, timeZone) ?? now;
}

export type CallbackRepository = {
  requestCallback(input: {estimateToken: string; callWindow: CallWindow; dueAt: Date}): Promise<{created: boolean} | null>;
};

const bodySchema = z.strictObject({callWindow: z.enum(callWindows)});
const noStore = {"cache-control": "no-store"};

/** "Have someone call me" from the quote chat, scoped by the estimate token. */
export async function handleCallbackRequest({token, body, repository, now = () => new Date()}: {
  token: string;
  body: unknown;
  repository: CallbackRepository;
  now?: () => Date;
}) {
  if (!z.uuid().safeParse(token).success) return NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({error: "Choose when we should call"}, {status: 400, headers: noStore});
  try {
    const result = await repository.requestCallback({
      estimateToken: token,
      callWindow: parsed.data.callWindow,
      dueAt: callbackDueAt(parsed.data.callWindow, now()),
    });
    if (!result) return NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
    return NextResponse.json({callWindow: parsed.data.callWindow, created: result.created}, {headers: noStore});
  } catch {
    return NextResponse.json({error: "unavailable"}, {status: 503, headers: noStore});
  }
}
