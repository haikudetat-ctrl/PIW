"use client";

import {useMemo, useState, type FormEvent} from "react";
import {formatClockTime, formatMeetingTime, timeZoneAbbreviation} from "@/modules/booking/booking-format";
import type {BookingPageModel, BookingSummary} from "@/modules/booking/booking-service";
import type {DaySlots} from "@/modules/booking/slots";

type OpenModel = Extract<BookingPageModel, {kind: "open" | "booked"}>;
type Mode = "pick" | "manage" | "reschedule" | "cancelled";

type ApiError = {error?: string; code?: string};

const dayLabel = new Intl.DateTimeFormat("en-US", {timeZone: "UTC", weekday: "short"});
const dateLabel = new Intl.DateTimeFormat("en-US", {timeZone: "UTC", day: "numeric"});
const longDateLabel = new Intl.DateTimeFormat("en-US", {timeZone: "UTC", weekday: "long", month: "long", day: "numeric"});

function noonUtc(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function firstOpenDay(days: DaySlots[]) {
  return days.find((day) => day.slots.length > 0)?.date ?? null;
}

async function call<T>(url: string, init?: RequestInit): Promise<{ok: true; data: T} | {ok: false; error: ApiError}> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {"content-type": "application/json", ...(init?.headers ?? {})},
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? {ok: true, data: body as T} : {ok: false, error: body as ApiError};
  } catch {
    return {ok: false, error: {error: "We couldn't reach the booking service. Check your connection and try again.", code: "network"}};
  }
}

export function BookingExperience({token, brandName, model}: {token: string; brandName: string; model: OpenModel}) {
  const base = `/api/booking/${encodeURIComponent(token)}`;
  const [days, setDays] = useState<DaySlots[]>(model.days);
  const [booking, setBooking] = useState<BookingSummary | null>(model.booking);
  const [mode, setMode] = useState<Mode>(model.booking ? "manage" : "pick");
  const [date, setDate] = useState<string | null>(firstOpenDay(model.days));
  const [slot, setSlot] = useState<string | null>(null);
  const [differentEmail, setDifferentEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const zone = model.timezone;
  const zoneName = timeZoneAbbreviation(booking?.startsAt ?? new Date(), zone);
  const selectedDay = useMemo(() => days.find((day) => day.date === date) ?? null, [days, date]);
  const hasAnySlot = days.some((day) => day.slots.length > 0);

  async function refreshSlots(message: string | null) {
    const result = await call<{days: DaySlots[]}>(base);
    if (result.ok) {
      setDays(result.data.days);
      setDate((current) => (result.data.days.some((day) => day.date === current && day.slots.length) ? current : firstOpenDay(result.data.days)));
    }
    setSlot(null);
    setError(message);
  }

  async function handleFailure(failure: ApiError) {
    if (failure.code === "slot_unavailable") {
      await refreshSlots(failure.error ?? "That time was just taken. Please pick another.");
      return;
    }
    if (failure.code === "already_booked") {
      window.location.reload();
      return;
    }
    setError(failure.error ?? "Something went wrong. Please try again.");
  }

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!slot) return;
    setBusy(true);
    setError(null);
    const result = await call<BookingSummary>(base, {
      method: "POST",
      body: JSON.stringify({startsAt: slot, attendeeEmail: differentEmail ? email : "", notes}),
    });
    setBusy(false);
    if (!result.ok) return handleFailure(result.error);
    setBooking(result.data);
    setSlot(null);
    setMode("manage");
  }

  async function reschedule() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    const result = await call<BookingSummary>(`${base}/reschedule`, {method: "POST", body: JSON.stringify({startsAt: slot})});
    setBusy(false);
    if (!result.ok) return handleFailure(result.error);
    setBooking(result.data);
    setSlot(null);
    setMode("manage");
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    const result = await call<{cancelled: true}>(`${base}/cancel`, {method: "POST", body: "{}"});
    setBusy(false);
    setConfirmingCancel(false);
    if (!result.ok) return handleFailure(result.error);
    setBooking(null);
    setMode("cancelled");
  }

  async function startOver() {
    setBusy(true);
    await refreshSlots(null);
    setBusy(false);
    setMode("pick");
  }

  if (mode === "cancelled") {
    return (
      <section className="book-body" aria-live="polite">
        <p className="book-kicker">Cancelled</p>
        <h1 className="quiet-question">Your consultation is cancelled.</h1>
        <p className="quiet-lede">Nothing else is needed from you. If you&apos;d like to talk later, you can pick a new time whenever it suits you.</p>
        <div className="book-actions">
          <button type="button" className="quiet-secondary" onClick={startOver} disabled={busy}>
            {busy ? "Loading times…" : "Pick a new time"}
          </button>
        </div>
      </section>
    );
  }

  if (mode === "manage" && booking) {
    return (
      <section className="book-body" aria-live="polite">
        <p className="book-kicker">You&apos;re booked, {model.firstName}</p>
        <h1 className="quiet-question">{formatMeetingTime(booking.startsAt, zone)}</h1>
        <p className="quiet-lede">
          {booking.durationMinutes} minutes on Google Meet with a {brandName} roofing specialist.
        </p>

        <div className="book-actions">
          {booking.calendarReady && booking.meetingUrl ? (
            <a className="quiet-submit quiet-link-button" href={booking.meetingUrl} target="_blank" rel="noopener noreferrer">
              Join Google Meet
            </a>
          ) : null}
          <a className="quiet-secondary quiet-link-button" href={`${base}/calendar`}>
            Add to my calendar
          </a>
        </div>

        <dl className="book-facts">
          <div>
            <dt>Invite sent to</dt>
            <dd>{booking.inviteEmail ?? model.inviteEmail}</dd>
          </div>
          <div>
            <dt>Video link</dt>
            <dd>{booking.calendarReady ? "In your calendar invite" : "Arriving in your calendar invite shortly"}</dd>
          </div>
        </dl>

        {booking.canChange ? (
          confirmingCancel ? (
            <div className="book-confirm" role="group" aria-label="Cancel consultation">
              <p className="book-chosen">Cancel this consultation?</p>
              <button type="button" className="quiet-submit" onClick={cancel} disabled={busy}>
                {busy ? "Cancelling…" : "Yes, cancel it"}
              </button>
              <button type="button" className="book-link" onClick={() => setConfirmingCancel(false)}>
                Keep my consultation
              </button>
            </div>
          ) : (
            <div className="book-actions">
              {days.length > 0 ? (
                <button type="button" className="quiet-secondary" onClick={() => { setMode("reschedule"); setSlot(null); setError(null); }}>
                  Change the time
                </button>
              ) : null}
              <button type="button" className="book-link" onClick={() => setConfirmingCancel(true)}>
                Cancel consultation
              </button>
            </div>
          )
        ) : null}
        {error ? <p className="book-error" role="alert">{error}</p> : null}
        {model.supportPhone ? <p className="quiet-notice" style={{marginTop: "2rem"}}>Questions before then? Call {model.supportPhone}.</p> : null}
      </section>
    );
  }

  const rescheduling = mode === "reschedule";
  return (
    <section className="book-body">
      <p className="book-kicker">{rescheduling ? "Change your time" : `Hi ${model.firstName}`}</p>
      <h1 className="quiet-question">
        {rescheduling ? "Pick a new time." : "Pick a time for your video consultation."}
      </h1>
      <p className="quiet-lede">
        {model.durationMinutes} minutes on Google Meet with a {brandName} roofing specialist. Times shown in {zoneName}.
      </p>

      {!hasAnySlot ? (
        <p className="quiet-lede" style={{marginTop: "2rem"}}>
          There are no open times right now.
          {model.supportPhone ? ` Call ${model.supportPhone} and we'll find one that works.` : " Please check back soon."}
        </p>
      ) : (
        <>
          <p className="book-section-label" id="book-day-label">Day</p>
          <div className="book-days" role="radiogroup" aria-labelledby="book-day-label">
            {days.map((day) => {
              const noon = noonUtc(day.date);
              return (
                <button
                  key={day.date}
                  type="button"
                  role="radio"
                  aria-checked={day.date === date}
                  aria-label={`${longDateLabel.format(noon)}${day.slots.length ? "" : ", no times open"}`}
                  className="book-day"
                  disabled={day.slots.length === 0}
                  onClick={() => { setDate(day.date); setSlot(null); setError(null); }}
                >
                  <span>{dayLabel.format(noon)}</span>
                  <span>{dateLabel.format(noon)}</span>
                </button>
              );
            })}
          </div>

          {selectedDay ? (
            <>
              <p className="book-section-label" id="book-time-label">{longDateLabel.format(noonUtc(selectedDay.date))}</p>
              <div className="book-slots" role="radiogroup" aria-labelledby="book-time-label">
                {selectedDay.slots.map((option) => (
                  <button
                    key={option.startsAt}
                    type="button"
                    role="radio"
                    aria-checked={slot === option.startsAt}
                    className="book-slot"
                    onClick={() => { setSlot(option.startsAt); setError(null); }}
                  >
                    {formatClockTime(option.startsAt, zone)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      {error ? <p className="book-error" role="alert">{error}</p> : null}

      {slot && rescheduling ? (
        <div className="book-confirm">
          <p className="book-chosen">Move to {formatMeetingTime(slot, zone)}?</p>
          <button type="button" className="quiet-submit" onClick={reschedule} disabled={busy}>
            {busy ? "Moving…" : "Move my consultation"}
          </button>
        </div>
      ) : null}

      {slot && !rescheduling ? (
        <form className="book-confirm" onSubmit={book}>
          <p className="book-chosen">{formatMeetingTime(slot, zone)}</p>
          {differentEmail ? (
            <label className="quiet-field">
              Email for your invite
              <input
                className="quiet-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          ) : (
            <p className="quiet-hint">
              We&apos;ll send the Google Meet invite to {model.inviteEmail}.{" "}
              <button type="button" className="book-link" onClick={() => setDifferentEmail(true)}>
                Use a different email
              </button>
            </p>
          )}
          <label className="quiet-field">
            Anything you&apos;d like us to look at? (optional)
            <textarea
              className="book-textarea"
              maxLength={1000}
              value={notes}
              placeholder="A leak over the porch, storm damage, a second opinion on a quote…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <button type="submit" className="quiet-submit" disabled={busy}>
            {busy ? "Booking…" : "Book my consultation"}
          </button>
        </form>
      ) : null}

      {rescheduling ? (
        <button type="button" className="quiet-back" onClick={() => { setMode("manage"); setSlot(null); setError(null); }}>
          Keep my current time
        </button>
      ) : null}
    </section>
  );
}
