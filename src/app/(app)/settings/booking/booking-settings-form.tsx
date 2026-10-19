"use client";

import { useActionState } from "react";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";
import { toClock } from "@/modules/booking/weekly-hours";
import { saveBookingSettings, type BookingSettingsFormState } from "./actions";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type BookingSettingsValues = {
  isEnabled: boolean;
  googleCalendarId: string;
  meetingTitle: string;
  meetingDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  concurrentCapacity: number;
  sendCalendarInvites: boolean;
  supportPhone: string;
  windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
};

function NumberField({ name, label, defaultValue, min, max, step, hint }: {
  name: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className={labelClasses}>{label}</span>
      <input name={name} type="number" inputMode="numeric" required min={min} max={max} step={step ?? 1} defaultValue={defaultValue} className={inputClasses} />
      {hint ? <span className="mt-1 block text-xs text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

export function BookingSettingsForm({ values }: { values: BookingSettingsValues }) {
  const [state, action, pending] = useActionState<BookingSettingsFormState, FormData>(saveBookingSettings, null);

  return (
    <form action={action} className="flex flex-col gap-6">
      <label className="flex items-start gap-3">
        <input type="checkbox" name="isEnabled" defaultChecked={values.isEnabled} className="mt-0.5 size-4 accent-current" />
        <span>
          <span className="block text-sm font-medium text-ink">Homeowners can book video consultations</span>
          <span className="block text-xs text-ink-subtle">Booking links and the estimate page offer open times while this is on.</span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClasses}>Shared Google Calendar ID</span>
          <input name="googleCalendarId" defaultValue={values.googleCalendarId} placeholder="abc123@group.calendar.google.com" className={`${inputClasses} font-mono text-xs`} />
          <span className="mt-1 block text-xs text-ink-subtle">
            Events and Meet links are created here. Anything else on this calendar blocks those times, so use it for days off and training.
          </span>
        </label>
        <label className="block">
          <span className={labelClasses}>Meeting title</span>
          <input name="meetingTitle" required maxLength={120} defaultValue={values.meetingTitle} className={inputClasses} />
        </label>
        <label className="block">
          <span className={labelClasses}>Support phone (shown to homeowners)</span>
          <input name="supportPhone" type="tel" defaultValue={values.supportPhone} className={inputClasses} />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField name="meetingDurationMinutes" label="Length (minutes)" defaultValue={values.meetingDurationMinutes} min={15} max={120} step={5} />
        <label className="block">
          <span className={labelClasses}>Start times every</span>
          <select name="slotIntervalMinutes" defaultValue={values.slotIntervalMinutes} className={inputClasses}>
            {[15, 20, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </label>
        <NumberField name="bufferMinutes" label="Gap between meetings (min)" defaultValue={values.bufferMinutes} min={0} max={60} step={5} />
        <NumberField name="minimumNoticeHours" label="Minimum notice (hours)" defaultValue={values.minimumNoticeMinutes / 60} min={0} max={168} step={0.5} />
        <NumberField name="bookingHorizonDays" label="Bookable days ahead" defaultValue={values.bookingHorizonDays} min={1} max={60} />
        <NumberField
          name="concurrentCapacity"
          label="Meetings at the same time"
          defaultValue={values.concurrentCapacity}
          min={1}
          max={20}
          hint="How many reps can take a call in the same slot."
        />
      </div>

      <fieldset>
        <legend className="text-[13px] font-semibold text-ink">Weekly hours (Eastern)</legend>
        <div className="mt-2 divide-y divide-border rounded-xl border border-border">
          {WEEKDAYS.map((label, weekday) => {
            const window = values.windows.find((item) => item.weekday === weekday);
            return (
              <div key={label} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <label className="flex w-36 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name={`day-${weekday}-open`} defaultChecked={Boolean(window)} className="size-4" />
                  {label}
                </label>
                <label className="sr-only" htmlFor={`day-${weekday}-start`}>{label} start</label>
                <input id={`day-${weekday}-start`} name={`day-${weekday}-start`} type="time" step={900} defaultValue={toClock(window?.startMinute ?? 540)} className={`${inputClasses} mt-0 w-32`} />
                <span className="text-xs text-ink-subtle">to</span>
                <label className="sr-only" htmlFor={`day-${weekday}-end`}>{label} end</label>
                <input id={`day-${weekday}-end`} name={`day-${weekday}-end`} type="time" step={900} defaultValue={toClock(window?.endMinute ?? 1020)} className={`${inputClasses} mt-0 w-32`} />
              </div>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input type="checkbox" name="sendCalendarInvites" defaultChecked={values.sendCalendarInvites} className="mt-0.5 size-4" />
        <span>
          <span className="block text-sm font-medium text-ink">Send Google Calendar invites</span>
          <span className="block text-xs text-ink-subtle">Homeowners and assigned reps get the invite with the Meet link, plus updates when it moves.</span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClasses}>{pending ? "Saving…" : "Save booking settings"}</button>
        {state ? (
          <p role={state.ok ? "status" : "alert"} className={`text-[13px] ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
