"use client";

import Link from "next/link";
import {useCallback, useEffect, useRef, useState, type FormEvent} from "react";
import {useMetaPixel} from "@/components/marketing/meta-pixel-provider";
import {formatClockTime, formatMeetingTime} from "@/modules/booking/booking-format";
import type {BookingPageModel} from "@/modules/booking/booking-service";
import type {DaySlots, Slot} from "@/modules/booking/slots";
import {contactOnlyNotice, PREVIEW_CONTACT_SUBMIT_LABEL} from "@/modules/property-preview/notices";
import type {PreviewView} from "@/modules/property-preview/preview-read-model";
import type {CallWindow, ChatEstimateSummary} from "@/modules/quote-chat/types";
import {loadAssessmentAerial} from "../../[token]/assessment-aerial-loader";
import {useAssessmentAerial} from "../../[token]/assessment-experience";
import {
  assessmentQuestionTitles,
  reasonOptions,
  roofAgeOptions,
  timelineOptions,
  type AssessmentOption,
} from "../../[token]/assessment-questions";
import type {QuietEstimateState} from "../../[token]/public-estimate-flow";
import {browserChatApi, type ChatApi, type PreviewQuestionKey} from "./chat-api";
import "../../quiet/quiet.css";
import "./quote-chat.css";

export type ChatBrand = {name: string; logoUrl?: string; phoneDisplay: string; phoneHref: string};

type OpenBooking = Extract<BookingPageModel, {kind: "open" | "booked"}>;
type BookingState = {token: string; model: OpenBooking};

type Entry =
  | {kind: "assistant"; text: string}
  | {kind: "reply"; text: string}
  | {kind: "roof"}
  | {kind: "price"; state: QuietEstimateState; estimateToken: string}
  | {kind: "booked"};

type Stage =
  | {name: "question"; key: PreviewQuestionKey}
  | {name: "contact"}
  | {name: "pricing"}
  | {name: "days"}
  | {name: "times"; date: string}
  | {name: "confirm"; startsAt: string; otherEmail: boolean}
  | {name: "callback"}
  | {name: "done"}
  | {name: "resuming"}
  | {name: "ended"; action: "restart" | "call"};

const QUESTIONS: Array<{key: PreviewQuestionKey; title: string; options: AssessmentOption[]}> = [
  {key: "reason", title: assessmentQuestionTitles.reason, options: reasonOptions},
  {key: "roofAge", title: assessmentQuestionTitles.roofAge, options: roofAgeOptions},
  {key: "timeline", title: "When are you hoping to get it done?", options: timelineOptions},
];

const COMPLEXITY = {simple: "a simple roof", moderate: "a moderately complex roof", complex: "a complex roof"} as const;

const CALL_WINDOWS: Array<{value: CallWindow; label: string; phrase: string}> = [
  {value: "asap", label: "As soon as possible", phrase: "as soon as possible during business hours"},
  {value: "morning", label: "Morning (9 to 12)", phrase: "in the morning"},
  {value: "afternoon", label: "Afternoon (12 to 5)", phrase: "in the afternoon"},
  {value: "evening", label: "Evening (5 to 8)", phrase: "in the early evening"},
];

const VISIBLE_DAYS = 6;
const MAX_PRICE_POLLS = 48;
const MAX_VIEW_POLLS = 30;
const MAX_MEET_POLLS = 10;

const money = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
const dayChip = new Intl.DateTimeFormat("en-US", {timeZone: "UTC", weekday: "short", month: "short", day: "numeric"});
const dayLong = new Intl.DateTimeFormat("en-US", {timeZone: "UTC", weekday: "long", month: "long", day: "numeric"});

const noonUtc = (dateKey: string) => new Date(`${dateKey}T12:00:00.000Z`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const storageKey = (token: string) => `quote-chat:${token}`;

function rememberEstimate(token: string, estimateToken: string) {
  try {
    window.sessionStorage.setItem(storageKey(token), JSON.stringify({estimateToken}));
  } catch {
    // Private windows can refuse storage; the chat only loses its resume.
  }
}

function recallEstimate(token: string): string | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey(token)) ?? "null") as {estimateToken?: unknown} | null;
    return typeof saved?.estimateToken === "string" ? saved.estimateToken : null;
  } catch {
    return null;
  }
}

function openDays(booking: BookingState | null): DaySlots[] {
  return booking?.model.kind === "open" ? booking.model.days.filter((day) => day.slots.length > 0) : [];
}

function contactPrompt() {
  return "Where should we send your price? It will show up right here too.";
}

const say = (text: string): Entry => ({kind: "assistant", text});
const reply = (text: string): Entry => ({kind: "reply", text});

function openingEntries(view: PreviewView, remaining: typeof QUESTIONS): Entry[] {
  const entries: Entry[] = [
    {kind: "assistant", text: "What’s the address of the home?"},
    {kind: "reply", text: view.address.display},
    {kind: "roof"},
  ];
  if (remaining.length === 0) {
    entries.push({kind: "assistant", text: `That’s your roof from above. I have what I need to price it.\n\n${contactPrompt()}`});
  } else {
    const taps = remaining.length === 1 ? "One quick tap" : `${remaining.length === 2 ? "Two" : "Three"} quick taps`;
    entries.push({kind: "assistant", text: `That’s your roof from above. ${taps} and I’ll price it.`});
    entries.push({kind: "assistant", text: remaining[0].title});
  }
  return entries;
}

function RoofCard({token, view, aerialLoader}: {token: string; view: PreviewView; aerialLoader: typeof loadAssessmentAerial}) {
  const imageUrl = `/api/property-preview/${token}/house-image`;
  const aerial = useAssessmentAerial({aerialLoader, enabled: view.image.state === "ready", imageUrl, stage: "reveal"});
  const roof = view.roof;
  return (
    <figure className="chat-roof">
      <div className="quiet-aerial">
        {aerial.kind === "ready" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={aerial.objectUrl} alt={`Aerial view of ${view.address.display}`} />
        ) : (
          <p className="quiet-aerial-pending">
            {view.image.state === "ready" ? "Loading the aerial view" : "We’ll review this address with you."}
          </p>
        )}
      </div>
      <figcaption className="chat-roof-caption">
        {roof.state === "ready" ? (
          <span>About {roof.squares} roofing squares, {COMPLEXITY[roof.complexity]}.</span>
        ) : roof.state === "pending" ? (
          <span role="status">Measuring your roof…</span>
        ) : roof.state === "review_required" ? (
          <span>A specialist will confirm the measurements.</span>
        ) : null}
        <span translate="no">Imagery from Google</span>
      </figcaption>
    </figure>
  );
}

function PriceCard({state, estimateToken}: {state: QuietEstimateState; estimateToken: string}) {
  if (state.kind !== "ready") return null;
  return (
    <section className="chat-card" aria-label="Your estimate">
      <p className="quiet-price chat-price">
        {money.format(state.lowCents / 100)} <span>to</span> {money.format(state.highCents / 100)}
      </p>
      <p className="chat-card-line">
        About {state.roofSquares.toFixed(1)} roofing squares at current New Jersey architectural-shingle prices.
      </p>
      <p className="quiet-notice chat-card-fine">
        Preliminary sales estimate only. Decking, tear-off layers, access, permits, and field conditions can change the final proposal.
      </p>
      <a className="chat-link" href={`/roof-estimate/${estimateToken}`} target="_blank" rel="noopener">
        Open the full estimate
      </a>
    </section>
  );
}

function BookedCard({booking, brand}: {booking: BookingState; brand: ChatBrand}) {
  const summary = booking.model.booking;
  if (!summary) return null;
  const base = `/api/booking/${encodeURIComponent(booking.token)}`;
  return (
    <section className="chat-card" aria-label="Your video call">
      <p className="chat-booked-time">
        {formatMeetingTime(summary.startsAt, booking.model.timezone).split(" at ").map((part) => <span key={part}>{part}</span>)}
      </p>
      <p className="chat-card-line">
        {summary.durationMinutes}-minute video call on Google Meet with a specialist from {brand.name}.
      </p>
      {summary.meetingUrl ? (
        <a className="quiet-submit quiet-link-button chat-card-action" href={summary.meetingUrl} target="_blank" rel="noopener noreferrer">
          Join on Google Meet
        </a>
      ) : (
        <p className="chat-card-line" role="status">
          The Google invite with the Meet link is on its way to {summary.inviteEmail ?? booking.model.inviteEmail}.
        </p>
      )}
      <div className="chat-links">
        <a className="chat-link" href={`${base}/calendar`}>Add to calendar</a>
        <a className="chat-link" href={`/book/${encodeURIComponent(booking.token)}`} target="_blank" rel="noopener">Change or cancel</a>
      </div>
    </section>
  );
}

/**
 * Guided quote chat. The website asks for the address and creates the preview;
 * this picks up the conversation on the estimate host: roof reveal, three
 * quick questions, contact (under the same notice as the preview flow), the
 * price, then a video call or a callback. Every step calls an existing PIW
 * endpoint; nothing here is generated text.
 */
export function QuoteChat({
  token,
  initialView,
  brand,
  privacyUrl,
  bookingAvailable,
  api = browserChatApi,
  aerialLoader = loadAssessmentAerial,
  pollMs = 2_500,
}: {
  token: string;
  initialView: PreviewView;
  brand: ChatBrand;
  privacyUrl: string;
  bookingAvailable: boolean;
  api?: ChatApi;
  aerialLoader?: typeof loadAssessmentAerial;
  pollMs?: number;
}) {
  const converted = initialView.status === "converted";
  const [answered, setAnswered] = useState(() => new Set(initialView.answered));
  const [entries, setEntries] = useState<Entry[]>(() => converted
    ? []
    : openingEntries(initialView, QUESTIONS.filter((question) => !initialView.answered.includes(question.key))));
  const [stage, setStage] = useState<Stage>(() => {
    if (converted) return {name: "resuming"};
    const next = QUESTIONS.find((question) => !initialView.answered.includes(question.key));
    return next ? {name: "question", key: next.key} : {name: "contact"};
  });
  const [view, setView] = useState(initialView);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [submissionId] = useState(() => globalThis.crypto.randomUUID());
  const estimateToken = useRef<string | null>(null);
  const alive = useRef(true);
  const revealed = useRef(false);
  const contactShown = useRef(false);
  const scrolled = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const {trackConversion} = useMetaPixel();

  const append = useCallback((...items: Entry[]) => setEntries((current) => [...current, ...items]), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The reveal and contact beacons feed the same funnel counts as the preview page.
  useEffect(() => {
    if (converted || revealed.current) return;
    revealed.current = true;
    api.beacon(token, "revealed");
    trackConversion({name: "RoofPreviewStarted", eventId: initialView.metaEventId, issuedAt: new Date().toISOString()});
  }, [api, converted, initialView.metaEventId, token, trackConversion]);

  useEffect(() => {
    if (stage.name !== "contact" || contactShown.current) return;
    contactShown.current = true;
    api.beacon(token, "contact_viewed");
  }, [api, stage.name, token]);

  // The Solar measurement usually lands within seconds; keep the roof card current.
  useEffect(() => {
    if (view.roof.state !== "pending") return;
    let polls = 0;
    const timer = window.setInterval(async () => {
      polls += 1;
      if (polls > MAX_VIEW_POLLS) {
        window.clearInterval(timer);
        return;
      }
      const next = await api.loadPreview(token);
      if (alive.current && next) setView(next);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [api, pollMs, token, view.roof.state]);

  useEffect(() => {
    if (!scrolled.current) {
      scrolled.current = true;
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    end.current?.scrollIntoView?.({block: "end", behavior: reduced ? "auto" : "smooth"});
  }, [entries.length, stage]);

  const loadBooking = useCallback(async (estimate: string): Promise<BookingState | null> => {
    const linkToken = await api.bookingLink(estimate);
    if (!linkToken) return null;
    const model = await api.bookingOverview(linkToken);
    return model && (model.kind === "open" || model.kind === "booked") ? {token: linkToken, model} : null;
  }, [api]);

  const waitForMeetLink = useCallback(async (current: BookingState) => {
    for (let poll = 0; poll < MAX_MEET_POLLS && alive.current; poll += 1) {
      await wait(pollMs + 500);
      const model = await api.bookingOverview(current.token);
      if (!alive.current) return;
      if (model?.kind === "booked" && model.booking) {
        setBooking({token: current.token, model});
        if (model.booking.calendarReady) return;
      }
    }
  }, [api, pollMs]);

  const offerNext = useCallback((state: QuietEstimateState | null, current: BookingState | null) => {
    if (current?.model.kind === "booked" && current.model.booking) {
      setBooking(current);
      append(say("You already have a video call booked."), {kind: "booked"});
      setStage({name: "done"});
      if (!current.model.booking.calendarReady) void waitForMeetLink(current);
      return;
    }
    if (current && openDays(current).length > 0) {
      setBooking(current);
      const minutes = current.model.durationMinutes;
      append(say(state?.kind === "ready"
        ? `Want to go over it with a specialist? Pick a day for a ${minutes}-minute video call.`
        : `The quickest way to a firm number is a ${minutes}-minute video call with a specialist. Pick a day that works.`));
      setStage({name: "days"});
      return;
    }
    append(say("Want a specialist to call you to go over it? Pick a time of day."));
    setStage({name: "callback"});
  }, [append, waitForMeetLink]);

  const priceAndOffer = useCallback(async (estimate: string) => {
    estimateToken.current = estimate;
    setStage({name: "pricing"});
    const bookingLoad = bookingAvailable ? loadBooking(estimate).catch(() => null) : Promise.resolve(null);
    let summary: ChatEstimateSummary | null = null;
    for (let poll = 0; poll < MAX_PRICE_POLLS && alive.current; poll += 1) {
      summary = await api.loadEstimate(estimate);
      if (summary && !summary.pending) break;
      await wait(pollMs);
    }
    if (!alive.current) return;
    if (!summary || summary.pending) {
      append(say("Your price is taking longer than usual. We’ll text and email it as soon as it’s ready."));
    } else if (summary.state.kind === "ready") {
      append(say("Here’s your estimate."), {kind: "price", state: summary.state, estimateToken: estimate});
    } else if (summary.state.kind === "review") {
      append(say("Google didn’t return a measurement we trust enough to price this roof automatically, so a specialist will confirm it with you."));
    } else {
      append(say("I couldn’t create a reliable instant range for this roof. A specialist can review it with you."));
    }
    const current = await bookingLoad;
    if (!alive.current) return;
    offerNext(summary && !summary.pending ? summary.state : null, current);
  }, [api, append, bookingAvailable, loadBooking, offerNext, pollMs]);

  // Coming back to a chat that already has contact details: pick up at the price.
  useEffect(() => {
    if (!converted) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const saved = recallEstimate(token);
      if (!saved) {
        append(say("Your price is on its way by text and email. Open it there to see your options."));
        setStage({name: "ended", action: "call"});
        return;
      }
      append(say("Welcome back. Here’s where we left off."));
      await priceAndOffer(saved);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once for the page's initial state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function answer(key: PreviewQuestionKey, option: AssessmentOption) {
    if (stage.name !== "question" || stage.key !== key) return;
    api.answer(token, key, option.value);
    const nowAnswered = new Set(answered).add(key);
    setAnswered(nowAnswered);
    const next = QUESTIONS.find((question) => !nowAnswered.has(question.key));
    append(reply(option.label), say(next ? next.title : contactPrompt()));
    setStage(next ? {name: "question", key: next.key} : {name: "contact"});
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !event.currentTarget.reportValidity()) return;
    const form = new FormData(event.currentTarget);
    const contact = {
      submission_id: submissionId,
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
    };
    setBusy(true);
    setContactError(null);
    const result = await api.convert(token, contact);
    if (!alive.current) return;
    if (result.kind !== "accepted") {
      setBusy(false);
      if (result.kind === "expired") {
        append(say("This conversation has expired. Start again with your address to see your price."));
        setStage({name: "ended", action: "restart"});
        return;
      }
      setContactError(result.kind === "invalid"
        ? "Check your name, email, and mobile number, then try again."
        : `We couldn’t unlock your price. Try again, or call ${brand.phoneDisplay}.`);
      return;
    }
    append(reply(`${contact.name}\n${contact.email}\n${contact.phone}`));
    trackConversion(result.metaEvent);
    setStage({name: "pricing"});
    const next = await api.continueToEstimate(result.continuationPath);
    if (!alive.current) return;
    setBusy(false);
    if (next.kind !== "estimate") {
      append(say("Your price is on its way by text and email. Open it there to see your options."));
      setStage({name: "ended", action: "call"});
      return;
    }
    rememberEstimate(token, next.estimateToken);
    await priceAndOffer(next.estimateToken);
  }

  function pickDay(day: DaySlots) {
    append(reply(dayLong.format(noonUtc(day.date))), say("Which time works? Times are Eastern."));
    setStage({name: "times", date: day.date});
  }

  function pickTime(slot: Slot) {
    if (!booking) return;
    const when = formatMeetingTime(slot.startsAt, booking.model.timezone);
    append(
      reply(formatClockTime(slot.startsAt, booking.model.timezone)),
      say(`${when}. I’ll send the Google invite to ${booking.model.inviteEmail}.`),
    );
    setStage({name: "confirm", startsAt: slot.startsAt, otherEmail: false});
  }

  async function refreshBooking(message: string) {
    const current = booking;
    const model = current ? await api.bookingOverview(current.token) : null;
    if (!alive.current) return;
    if (current && model?.kind === "booked" && model.booking) {
      const next = {token: current.token, model};
      setBooking(next);
      setHandedOff(true);
      append(say(message), {kind: "booked"});
      setStage({name: "done"});
      if (!model.booking.calendarReady) void waitForMeetLink(next);
      return;
    }
    if (current && model?.kind === "open" && model.days.some((day) => day.slots.length > 0)) {
      setBooking({token: current.token, model});
      append(say(message));
      setStage({name: "days"});
      return;
    }
    append(say("There are no open times right now. Want a specialist to call you instead?"));
    setStage({name: "callback"});
  }

  async function book(startsAt: string, attendeeEmail?: string) {
    if (!booking || busy) return;
    append(reply(attendeeEmail ? `Book it, and send the invite to ${attendeeEmail}` : "Book it"));
    setBusy(true);
    const result = await api.book(booking.token, {startsAt, ...(attendeeEmail ? {attendeeEmail} : {})});
    if (!alive.current) return;
    setBusy(false);
    if (result.kind === "booked") {
      const next: BookingState = {token: booking.token, model: {...booking.model, kind: "booked", booking: result.booking}};
      setBooking(next);
      setHandedOff(true);
      append(say("You’re booked."), {kind: "booked"});
      setStage({name: "done"});
      if (!result.booking.calendarReady) void waitForMeetLink(next);
      return;
    }
    if (result.kind === "taken") {
      await refreshBooking("That time was just taken. Here are the open days now.");
      return;
    }
    if (result.kind === "already_booked") {
      await refreshBooking("Looks like a call is already booked for you.");
      return;
    }
    append(say(result.message ?? `I couldn’t book that time. Pick another, or call ${brand.phoneDisplay}.`));
    setStage({name: "days"});
  }

  function submitOtherEmail(event: FormEvent<HTMLFormElement>, startsAt: string) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const email = String(new FormData(event.currentTarget).get("attendeeEmail") ?? "").trim();
    void book(startsAt, email);
  }

  function askForCall() {
    append(reply("Have someone call me"), say("Sure. When’s a good time? Calls come from our New Jersey team during business hours."));
    setStage({name: "callback"});
  }

  async function requestCallback(choice: (typeof CALL_WINDOWS)[number]) {
    const estimate = estimateToken.current;
    if (!estimate || busy) return;
    append(reply(choice.label));
    setBusy(true);
    const ok = await api.requestCallback(estimate, choice.value);
    if (!alive.current) return;
    setBusy(false);
    setHandedOff(true);
    append(say(ok
      ? `Got it. Someone from ${brand.name} will call you ${choice.phrase}.`
      : `I couldn’t send that request. Call us at ${brand.phoneDisplay} instead.`));
    setStage({name: "done"});
  }

  function notNow() {
    append(reply("Not now"), say("No problem. Your estimate is saved, and we’ve sent it to you by text and email."));
    setStage({name: "done"});
  }

  function renderEntry(entry: Entry, index: number) {
    switch (entry.kind) {
      case "assistant":
        return <li key={index} className="chat-say">{entry.text}</li>;
      case "reply":
        return <li key={index} className="chat-reply">{entry.text}</li>;
      case "roof":
        return <li key={index} className="chat-item"><RoofCard token={token} view={view} aerialLoader={aerialLoader} /></li>;
      case "price":
        return <li key={index} className="chat-item"><PriceCard state={entry.state} estimateToken={entry.estimateToken} /></li>;
      case "booked":
        return booking ? <li key={index} className="chat-item"><BookedCard booking={booking} brand={brand} /></li> : null;
    }
  }

  const days = openDays(booking);
  const secondary = (
    <div className="chat-secondary">
      <button type="button" className="chat-text-button" onClick={askForCall} disabled={busy}>Have someone call me</button>
      <button type="button" className="chat-text-button" onClick={notNow} disabled={busy}>Not now</button>
    </div>
  );

  function renderControls() {
    switch (stage.name) {
      case "question": {
        const question = QUESTIONS.find((item) => item.key === stage.key)!;
        return (
          <div className="chat-chips" role="group" aria-label={question.title}>
            {question.options.map((option) => (
              <button key={option.value} type="button" className="chat-chip" onClick={() => answer(question.key, option)}>
                {option.label}
              </button>
            ))}
          </div>
        );
      }
      case "contact":
        return (
          <form onSubmit={submitContact} className="quiet-form chat-form" noValidate aria-label="Where to send your price">
            <label className="quiet-field">
              Full name
              <input name="name" autoComplete="name" required minLength={2} className="quiet-input" />
            </label>
            <label className="quiet-field">
              Email
              <input name="email" type="email" inputMode="email" autoComplete="email" required className="quiet-input" />
            </label>
            <label className="quiet-field">
              Mobile phone
              <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={7} className="quiet-input" />
            </label>
            <p data-testid="chat-contact-notice" className="quiet-notice">
              {contactOnlyNotice(brand.name)}{" "}
              <a href={privacyUrl}>Privacy Policy</a>
            </p>
            {contactError ? <p role="alert" className="quiet-alert">{contactError}</p> : null}
            <button type="submit" disabled={busy} className="quiet-submit">
              {busy ? "Unlocking your price…" : PREVIEW_CONTACT_SUBMIT_LABEL}
            </button>
          </form>
        );
      case "days": {
        const visible = showAllDays ? days : days.slice(0, VISIBLE_DAYS);
        return (
          <>
            <div className="chat-chips" role="group" aria-label="Days with open times">
              {visible.map((day) => (
                <button key={day.date} type="button" className="chat-chip" onClick={() => pickDay(day)}>
                  {dayChip.format(noonUtc(day.date))}
                </button>
              ))}
              {!showAllDays && days.length > VISIBLE_DAYS ? (
                <button type="button" className="chat-chip chat-chip-quiet" onClick={() => setShowAllDays(true)}>Later dates</button>
              ) : null}
            </div>
            {secondary}
          </>
        );
      }
      case "times": {
        const day = days.find((item) => item.date === stage.date);
        const timezone = booking?.model.timezone ?? "America/New_York";
        return (
          <>
            <div className="chat-chips" role="group" aria-label="Open times">
              {(day?.slots ?? []).map((slot) => (
                <button key={slot.startsAt} type="button" className="chat-chip" onClick={() => pickTime(slot)}>
                  {formatClockTime(slot.startsAt, timezone)}
                </button>
              ))}
            </div>
            <div className="chat-secondary">
              <button type="button" className="chat-text-button" onClick={() => setStage({name: "days"})}>Pick another day</button>
            </div>
          </>
        );
      }
      case "confirm":
        return stage.otherEmail ? (
          <form onSubmit={(event) => submitOtherEmail(event, stage.startsAt)} className="quiet-form chat-form" noValidate>
            <label className="quiet-field">
              Email for the invite
              <input name="attendeeEmail" type="email" inputMode="email" autoComplete="email" required className="quiet-input" />
            </label>
            <button type="submit" disabled={busy} className="quiet-submit">{busy ? "Booking…" : "Book it"}</button>
            <button type="button" className="chat-text-button" onClick={() => setStage({...stage, otherEmail: false})}>Use {booking?.model.inviteEmail} instead</button>
          </form>
        ) : (
          <>
            <div className="chat-chips">
              <button type="button" className="chat-chip chat-chip-primary" disabled={busy} onClick={() => void book(stage.startsAt)}>
                {busy ? "Booking…" : "Book it"}
              </button>
              <button type="button" className="chat-chip" disabled={busy} onClick={() => setStage({...stage, otherEmail: true})}>
                Send it to a different email
              </button>
            </div>
            <div className="chat-secondary">
              <button type="button" className="chat-text-button" disabled={busy} onClick={() => setStage({name: "days"})}>Pick another time</button>
            </div>
          </>
        );
      case "callback":
        return (
          <>
            <div className="chat-chips" role="group" aria-label="When to call">
              {CALL_WINDOWS.map((choice) => (
                <button key={choice.value} type="button" className="chat-chip" disabled={busy} onClick={() => void requestCallback(choice)}>
                  {choice.label}
                </button>
              ))}
            </div>
            <div className="chat-secondary">
              {days.length > 0 ? (
                <button type="button" className="chat-text-button" disabled={busy} onClick={() => setStage({name: "days"})}>Pick a video call time instead</button>
              ) : null}
              <button type="button" className="chat-text-button" disabled={busy} onClick={notNow}>Not now</button>
            </div>
          </>
        );
      case "done":
        return !handedOff && days.length > 0 ? (
          <div className="chat-secondary">
            <button type="button" className="chat-text-button" onClick={() => {
              append(say("Here are the open days."));
              setStage({name: "days"});
            }}>Pick a video call time after all</button>
          </div>
        ) : null;
      case "ended":
        return stage.action === "restart" ? (
          <Link className="quiet-submit quiet-link-button" href="/roof-estimate">Start again</Link>
        ) : (
          <a className="quiet-secondary quiet-link-button" href={brand.phoneHref}>Call {brand.phoneDisplay}</a>
        );
      case "pricing":
      case "resuming":
        return null;
    }
  }

  return (
    <main className="quiet-flow chat-flow">
      <div className="chat-frame">
        <header className="chat-top">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="quiet-logo" />
          ) : (
            <span className="chat-brand">{brand.name}</span>
          )}
          <a href={brand.phoneHref} className="chat-call">Call {brand.phoneDisplay}</a>
        </header>
        <ol className="chat-log" role="log" aria-live="polite" aria-label={`Conversation with ${brand.name}`}>
          {entries.map(renderEntry)}
          {stage.name === "pricing" || stage.name === "resuming" ? (
            <li className="chat-say chat-working" role="status">
              {stage.name === "pricing" ? "Pricing your roof" : "Picking up where we left off"}
              <span aria-hidden="true" className="chat-dots"><span>.</span><span>.</span><span>.</span></span>
            </li>
          ) : null}
        </ol>
        <div className="chat-controls">{renderControls()}</div>
        <div ref={end} className="chat-end" />
      </div>
    </main>
  );
}
