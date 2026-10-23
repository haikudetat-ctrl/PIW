"use client";

import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from "react";
import {
  isRoofAssessmentStepAnswered,
  roofAssessmentQuestionSteps,
  roofAssessmentStepResponsePatch,
  type RoofAssessmentResponses,
} from "@/domain/roof-assessment";
import {formatClockTime, formatMeetingTime} from "@/modules/booking/booking-format";
import type {BookingPageModel} from "@/modules/booking/booking-service";
import type {DaySlots, Slot} from "@/modules/booking/slots";
import type {CallWindow} from "@/modules/quote-chat/types";
import {
  assessmentQuestionTitles,
  complexityOptions,
  conditionOptions,
  ownershipOptions,
  priorityOptions,
  reasonOptions,
  roofAgeOptions,
  storyOptions,
  timelineOptions,
  type AssessmentOption,
} from "./assessment-questions";
import {browserFastQuoteApi, type AssessmentSnapshot, type FastQuoteApi} from "./fast-quote-api";
import type {QuietEstimateState} from "./public-estimate-flow";
import {PropertySatelliteImage} from "./property-satellite-image";
import "../quiet/quiet.css";
import "./fast-quote.css";

export type FastQuoteBrand = {name: string; logoUrl?: string; phoneDisplay: string; phoneHref: string};
type Summary = {pending: boolean; state: QuietEstimateState};
type OpenBooking = Extract<BookingPageModel, {kind: "open" | "booked"}>;
type BookingState = {token: string; model: OpenBooking};
type Responses = Partial<RoofAssessmentResponses>;
type Ownership = RoofAssessmentResponses["ownership"];

type Stage =
  | {name: "phases"}
  | {name: "quote"}
  | {name: "owner"}
  | {name: "renter"}
  | {name: "days"}
  | {name: "times"; date: string}
  | {name: "confirm"; startsAt: string; otherEmail: boolean}
  | {name: "callback"}
  | {name: "ended"; title: string; body: string}
  | {name: "booked"}
  | {name: "prep"; step: number}
  | {name: "done"; answered: boolean};

/** Shown at `phaseMs` each (0.25s by default) after contact details go in. */
export const QUOTE_PHASES = [
  "Confirming your address",
  "Checking the roof measurement",
  "Pricing three roof systems",
  "Preparing your estimate",
] as const;

const CALL_WINDOWS: Array<{value: CallWindow; label: string; phrase: string}> = [
  {value: "asap", label: "As soon as possible", phrase: "as soon as possible during business hours"},
  {value: "morning", label: "Morning (9 to 12)", phrase: "in the morning"},
  {value: "afternoon", label: "Afternoon (12 to 5)", phrase: "in the afternoon"},
  {value: "evening", label: "Evening (5 to 8)", phrase: "in the early evening"},
];

// Everyone but a "No" goes to the calendar: buyers and property managers are
// real decision makers. A renter is offered a call instead of a slot.
const BOOKABLE_OWNERSHIP: readonly Ownership[] = ["owner", "buying", "manager"];

const VISIBLE_DAYS = 6;
const MAX_LATE_POLLS = 30;
const MAX_MEET_POLLS = 10;
const PREP_STEPS = roofAssessmentQuestionSteps;
const LAST_STEP = PREP_STEPS.length - 1;

const money = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
const dayLong = new Intl.DateTimeFormat("en-US", {timeZone: "UTC", weekday: "long", month: "long", day: "numeric"});
const noonUtc = (dateKey: string) => new Date(`${dateKey}T12:00:00.000Z`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const range = (low: number, high: number) => `${money.format(low / 100)} to ${money.format(high / 100)}`;

function openDays(booking: BookingState | null): DaySlots[] {
  return booking?.model.kind === "open" ? booking.model.days.filter((day) => day.slots.length > 0) : [];
}

function bookedSummary(booking: BookingState | null) {
  return booking?.model.kind === "booked" ? booking.model.booking : null;
}

/** The ordered assessment steps still unanswered once the gate's answer is counted. */
function unansweredSteps(assessment: AssessmentSnapshot | null, ownership: Ownership | null) {
  if (!assessment || assessment.status !== "in_progress") return [];
  const responses = mergedResponses(assessment, ownership);
  return PREP_STEPS.map((_, index) => index)
    .filter((index) => index >= assessment.currentStep && !isRoofAssessmentStepAnswered(index, responses));
}

function mergedResponses(assessment: AssessmentSnapshot, ownership: Ownership | null): Responses {
  return {...assessment.responses, ...(ownership && !assessment.responses.ownership ? {ownership} : {})};
}

const SINGLE_OPTIONS: Partial<Record<(typeof PREP_STEPS)[number]["id"], AssessmentOption[]>> = {
  reason: reasonOptions,
  roofAge: roofAgeOptions,
  stories: storyOptions,
  priority: priorityOptions,
  timeline: timelineOptions,
  ownership: ownershipOptions,
};

const VISIBLE_CONDITION_OPTIONS: AssessmentOption<RoofAssessmentResponses["visibleCondition"]>[] = [
  {value: "healthy", label: "Looks healthy"},
  {value: "moderate_wear", label: "Moderate wear"},
  {value: "heavy_wear", label: "Heavy wear"},
];

function toggle(selected: readonly string[] | undefined, value: string, exclusive: readonly string[]) {
  const current = selected ?? [];
  if (exclusive.includes(value)) return current.includes(value) ? [] : [value];
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current.filter((item) => !exclusive.includes(item)), value];
}

const HEADING_ID = "fast-quote-heading";
const YES_NO: AssessmentOption[] = [{value: "yes", label: "Yes"}, {value: "no", label: "No"}];

function Screen({brand, alert, wide = false, children}: {
  brand: FastQuoteBrand;
  alert: string | null;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="quiet-flow fq-flow">
      <div className={wide ? "quiet-frame fq-frame-wide" : "quiet-frame"}>
        <header className="quiet-header fq-header">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="quiet-logo" />
          ) : (
            <span>{brand.name.toUpperCase()}</span>
          )}
          <a href={brand.phoneHref} className="fq-header-call">{brand.phoneDisplay}</a>
        </header>
        <section className="quiet-body fq-body">
          {children}
          {alert ? <p role="alert" className="quiet-alert fq-alert">{alert}</p> : null}
        </section>
      </div>
    </main>
  );
}

/** Each screen's heading; it takes focus when the screen changes. */
function Title({children}: {children: ReactNode}) {
  return <h1 id={HEADING_ID} tabIndex={-1} className="quiet-question fq-heading">{children}</h1>;
}

function TextButton({children, onClick, disabled}: {children: ReactNode; onClick: () => void; disabled?: boolean}) {
  return <button type="button" className="quiet-back" onClick={onClick} disabled={disabled}>{children}</button>;
}

function Options({items, label, disabled, onPick}: {
  items: AssessmentOption[];
  label: string;
  disabled?: boolean;
  onPick: (option: AssessmentOption) => void;
}) {
  return (
    <div className="quiet-options" role="group" aria-label={label}>
      {items.map((option) => (
        <button key={option.value} type="button" className="quiet-option" disabled={disabled} onClick={() => onPick(option)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BookedDetails({booking, brand}: {booking: BookingState; brand: FastQuoteBrand}) {
  const call = booking.model.booking;
  if (!call) return null;
  const base = `/api/booking/${encodeURIComponent(booking.token)}`;
  return (
    <>
      <p className="quiet-lede">
        {call.durationMinutes}-minute video call on Google Meet with a specialist from {brand.name}.
      </p>
      {call.meetingUrl ? (
        <a className="quiet-secondary quiet-link-button quiet-cta" href={call.meetingUrl} target="_blank" rel="noopener noreferrer">
          Join on Google Meet
        </a>
      ) : (
        <p className="quiet-lede" role="status">
          The Google invite with the Meet link is on its way to {call.inviteEmail ?? booking.model.inviteEmail}.
        </p>
      )}
      <div className="fq-links">
        <a className="fq-link" href={`${base}/calendar`}>Add to calendar</a>
        <a className="fq-link" href={`/book/${encodeURIComponent(booking.token)}`}>Change or cancel</a>
      </div>
    </>
  );
}

/**
 * Price-first result for value-first leads with fast booking on: a second of
 * progress, the Good/Better/Best estimate, then a video call booked in a few
 * taps (after "Do you own this home?"), and only then the remaining questions,
 * framed as getting the specialist ready for the call.
 */
export function FastQuote({
  token,
  address,
  brand,
  initial,
  animate,
  bookingAvailable,
  api = browserFastQuoteApi,
  phaseMs = 250,
  holdMs = 15_000,
  pollMs = 1_500,
  latePollMs = 4_000,
  imageSrc,
}: {
  token: string;
  address: string;
  brand: FastQuoteBrand;
  initial: Summary;
  animate: boolean;
  bookingAvailable: boolean;
  api?: FastQuoteApi;
  phaseMs?: number;
  holdMs?: number;
  pollMs?: number;
  latePollMs?: number;
  /** The aerial beside the ranges; defaults to the estimate's own image route. */
  imageSrc?: string;
}) {
  const [stage, setStageState] = useState<Stage>(animate ? {name: "phases"} : {name: "quote"});
  const [summary, setSummary] = useState<Summary>(initial);
  const [phase, setPhase] = useState(animate ? 0 : QUOTE_PHASES.length - 1);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [bookingLoaded, setBookingLoaded] = useState(!bookingAvailable);
  const [assessment, setAssessment] = useState<AssessmentSnapshot | null>(null);
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const [draft, setDraft] = useState<Responses>({});
  // The questions to ask, fixed when the homeowner starts, so "2 of 5" holds steady.
  const [prepPlan, setPrepPlan] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);
  const alive = useRef(true);
  const firstStage = useRef(true);
  const ownershipSave = useRef<Promise<unknown>>(Promise.resolve());

  const setStage = useCallback((next: Stage) => {
    setAlert(null);
    setStageState(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Each screen starts at the top with its heading focused for screen readers.
  useEffect(() => {
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    window.scrollTo({top: 0});
    document.getElementById(HEADING_ID)?.focus({preventScroll: true});
  }, [stage]);

  // Booking times and the saved assessment load while the phases run.
  useEffect(() => {
    if (!bookingAvailable) return;
    void (async () => {
      const linkToken = await api.bookingLink(token).catch(() => null);
      const model = linkToken ? await api.bookingOverview(linkToken).catch(() => null) : null;
      if (!alive.current) return;
      if (linkToken && model && (model.kind === "open" || model.kind === "booked")) setBooking({token: linkToken, model});
      setBookingLoaded(true);
    })();
  }, [api, bookingAvailable, token]);

  useEffect(() => {
    void api.loadAssessment(token).catch(() => null).then((loaded) => {
      if (alive.current && loaded) setAssessment(loaded);
    });
  }, [api, token]);

  // The phases: one every `phaseMs`, then hold on the last until the price
  // lands or `holdMs` passes. Booking never waits on the price.
  useEffect(() => {
    if (stage.name !== "phases") return;
    if (phase < QUOTE_PHASES.length - 1) {
      const timer = window.setTimeout(() => setPhase((current) => current + 1), phaseMs);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      await wait(phaseMs);
      const holdUntil = Date.now() + holdMs;
      let current = summary;
      while (!cancelled && current.pending && Date.now() < holdUntil) {
        await wait(pollMs);
        const next = await api.loadEstimate(token).catch(() => null);
        if (next && !cancelled) {
          current = {pending: next.pending, state: next.state};
          setSummary(current);
        }
      }
      if (!cancelled && alive.current) setStage({name: "quote"});
    })();
    return () => {
      cancelled = true;
    };
    // `summary` is read once when the hold starts; the loop keeps its own copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.name, phase, phaseMs, holdMs, pollMs, api, token, setStage]);

  // Still pricing after the hold: keep checking quietly and swap the price in.
  const latePolling = stage.name !== "phases" && summary.pending;
  useEffect(() => {
    if (!latePolling) return;
    let cancelled = false;
    void (async () => {
      for (let poll = 0; poll < MAX_LATE_POLLS && !cancelled; poll += 1) {
        await wait(latePollMs);
        const next = await api.loadEstimate(token).catch(() => null);
        if (cancelled || !next) continue;
        setSummary({pending: next.pending, state: next.state});
        if (!next.pending) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, latePollMs, latePolling, token]);

  const waitForMeetLink = useCallback(async (current: BookingState) => {
    for (let poll = 0; poll < MAX_MEET_POLLS && alive.current; poll += 1) {
      await wait(latePollMs);
      const model = await api.bookingOverview(current.token).catch(() => null);
      if (!alive.current) return;
      if (model?.kind === "booked" && model.booking) {
        setBooking({token: current.token, model});
        if (model.booking.calendarReady) return;
      }
    }
  }, [api, latePollMs]);

  const days = openDays(booking);
  const booked = bookedSummary(booking);
  const remaining = unansweredSteps(assessment, ownership);
  const canBook = bookingAvailable && (!bookingLoaded || days.length > 0 || Boolean(booked));

  function chooseOwnership(option: AssessmentOption) {
    const value = option.value as Ownership;
    setOwnership(value);
    // The gate never waits on the save; the questions after booking do.
    ownershipSave.current = api.saveOwnership(token, value).catch(() => false);
    if (!BOOKABLE_OWNERSHIP.includes(value)) {
      setStage({name: "renter"});
      return;
    }
    setStage(days.length > 0 || !bookingLoaded ? {name: "days"} : {name: "callback"});
  }

  function startBooking() {
    if (booked) {
      setStage({name: "booked"});
      return;
    }
    // Anyone who already answered (an earlier visit) skips the gate.
    const known = ownership ?? assessment?.responses.ownership ?? null;
    if (known && BOOKABLE_OWNERSHIP.includes(known)) {
      setOwnership(known);
      setStage({name: "days"});
      return;
    }
    setStage({name: "owner"});
  }

  async function refreshBooking(message: string) {
    const current = booking;
    const model = current ? await api.bookingOverview(current.token).catch(() => null) : null;
    if (!alive.current) return;
    if (current && model && (model.kind === "open" || model.kind === "booked")) {
      setBooking({token: current.token, model});
      if (model.kind === "booked" && model.booking) {
        setStage({name: "booked"});
        await loadPrep();
        return;
      }
      if (openDays({token: current.token, model}).length > 0) {
        setStage({name: "days"});
        setAlert(message);
        return;
      }
    }
    setStage({name: "callback"});
    setAlert("There are no open times right now. A specialist can call you instead.");
  }

  async function loadPrep() {
    await ownershipSave.current;
    const loaded = await api.loadAssessment(token).catch(() => null);
    if (alive.current && loaded) setAssessment(loaded);
  }

  async function book(startsAt: string, attendeeEmail?: string) {
    if (!booking || busy) return;
    setBusy(true);
    setAlert(null);
    const result = await api.book(booking.token, {startsAt, ...(attendeeEmail ? {attendeeEmail} : {})});
    if (!alive.current) return;
    setBusy(false);
    if (result.kind === "booked") {
      const next: BookingState = {token: booking.token, model: {...booking.model, kind: "booked", booking: result.booking}};
      setBooking(next);
      setStage({name: "booked"});
      if (!result.booking.calendarReady) void waitForMeetLink(next);
      await loadPrep();
      return;
    }
    if (result.kind === "taken") {
      await refreshBooking("That time was just taken. Here are the open days now.");
      return;
    }
    if (result.kind === "already_booked") {
      await refreshBooking("You already have a call booked.");
      return;
    }
    setAlert(result.message ?? `We couldn’t book that time. Pick another, or call ${brand.phoneDisplay}.`);
  }

  function submitOtherEmail(event: FormEvent<HTMLFormElement>, startsAt: string) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void book(startsAt, String(new FormData(event.currentTarget).get("attendeeEmail") ?? "").trim());
  }

  async function requestCallback(choice: (typeof CALL_WINDOWS)[number]) {
    if (busy) return;
    setBusy(true);
    const ok = await api.requestCallback(token, choice.value).catch(() => false);
    if (!alive.current) return;
    setBusy(false);
    setStage(ok
      ? {name: "ended", title: `We’ll call you ${choice.phrase}.`, body: `Calls come from the ${brand.name} team in New Jersey. Your estimate is on its way by text and email.`}
      : {name: "ended", title: "We couldn’t send that request.", body: `Call us at ${brand.phoneDisplay} and we’ll take it from there.`});
  }

  function notNow() {
    setStage({name: "ended", title: "No problem.", body: "Your estimate is saved and on its way by text and email. Book a call from there whenever you’re ready."});
  }

  // The remaining questions, saved one by one in the assessment's own order.
  // Steps already answered (the preview's timeline, the gate's ownership) are
  // confirmed on the way past without asking again.
  async function advance(from: number, responses: Responses, snapshot: AssessmentSnapshot) {
    let current = snapshot;
    let answers = responses;
    for (let index = from; index <= LAST_STEP; index += 1) {
      if (!isRoofAssessmentStepAnswered(index, answers)) {
        setAssessment(current);
        setDraft({});
        setBusy(false);
        setStage({name: "prep", step: index});
        return;
      }
      const step = PREP_STEPS[index];
      const save = (expectedRevision: number) => api.saveAnswer(token, {
        expectedRevision,
        questionId: step.id,
        responsePatch: roofAssessmentStepResponsePatch(index, answers),
        complete: index === LAST_STEP,
      }).catch(() => ({kind: "failed" as const}));
      let result = await save(current.revision);
      if (result.kind === "conflict" && result.assessment) {
        current = result.assessment;
        answers = {...result.assessment.responses, ...roofAssessmentStepResponsePatch(index, answers)};
        result = await save(current.revision);
      }
      if (!alive.current) return;
      if (result.kind !== "saved") {
        setBusy(false);
        setAlert("We couldn’t save that answer. Try again, or skip the rest. Your call is still booked.");
        return;
      }
      current = result.assessment;
      answers = mergedResponses(result.assessment, ownership);
      if (result.assessment.status !== "in_progress") break;
    }
    setAssessment(current);
    setBusy(false);
    setStage({name: "done", answered: true});
  }

  function startPrep() {
    if (!assessment || busy || remaining.length === 0) return;
    setPrepPlan(remaining);
    setBusy(true);
    void advance(assessment.currentStep, mergedResponses(assessment, ownership), assessment);
  }

  function answer(patch: Responses) {
    if (stage.name !== "prep" || !assessment || busy) return;
    const responses = {...mergedResponses(assessment, ownership), ...draft, ...patch};
    if (!isRoofAssessmentStepAnswered(stage.step, responses)) {
      setDraft({...draft, ...patch});
      return;
    }
    setBusy(true);
    setDraft({...draft, ...patch});
    void advance(stage.step, responses, assessment);
  }

  const callWindowOptions = (
    <Options
      items={CALL_WINDOWS.map((item) => ({value: item.value, label: item.label}))}
      label="When to call"
      disabled={busy}
      onPick={(option) => void requestCallback(CALL_WINDOWS.find((item) => item.value === option.value)!)}
    />
  );
  const go = (next: Stage) => () => setStage(next);

  switch (stage.name) {
    case "phases": {
      const holding = phase === QUOTE_PHASES.length - 1;
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Building your estimate</p>
          <Title>Preparing your estimate.</Title>
          <p className="quiet-lede">Matching {address} with your roof measurement.</p>
          <ol className="quiet-stages" aria-hidden="true">
            {QUOTE_PHASES.map((label, index) => (
              <li key={label} className="quiet-stage" data-active={index === phase} data-complete={index < phase}>
                <span>{label}</span>
                <span>{index < phase ? "Done" : index === phase ? "…" : ""}</span>
              </li>
            ))}
          </ol>
          <p role="status" className="sr-only">{QUOTE_PHASES[phase]}</p>
          <div className={holding ? "quiet-progress quiet-progress-indeterminate" : "quiet-progress"} aria-hidden="true">
            <span style={holding ? undefined : {width: `${((phase + 1) / QUOTE_PHASES.length) * 100}%`}} />
          </div>
        </Screen>
      );
    }

    case "quote": {
      const state = summary.state;
      const ready = state.kind === "ready" ? state : null;
      const tiers = ready?.packages?.length === 3 ? ready.packages : null;
      const headline = summary.pending
        ? "Your estimate is almost ready."
        : ready
          ? "Your estimate is ready."
          : state.kind === "review"
            ? "A specialist will confirm your roof."
            : "Your request is with our team.";
      const lede = summary.pending
        ? "We’ll text and email your range the moment it’s ready. You can book your call now."
        : ready
          ? `Based on about ${ready.roofSquares.toFixed(1)} roofing squares measured from above.`
          : state.kind === "review"
            ? "Google didn’t return a measurement we trust enough to price automatically. A specialist can go over it with you on a call."
            : "We couldn’t create a reliable instant range. A specialist can review the property with you on a call.";
      return (
        <Screen brand={brand} alert={alert} wide>
          <div className="fq-quote">
            <figure className="fq-aerial-figure">
              <div className="quiet-aerial fq-aerial">
                <PropertySatelliteImage src={imageSrc ?? `/api/roof-estimate/${token}/house-image`} address={address} />
              </div>
              <figcaption className="quiet-caption fq-caption">
                <span className="fq-caption-address">{address}</span>
                <span translate="no">Satellite imagery from Google Maps</span>
              </figcaption>
            </figure>
            <div className="fq-quote-copy">
              <p className="quiet-step">Preliminary estimate</p>
              <Title>{headline}</Title>
              {summary.pending ? (
                <div className="quiet-progress quiet-progress-indeterminate" aria-hidden="true"><span /></div>
              ) : tiers ? (
                <ol className="fq-tiers" aria-label="Your three options">
                  {tiers.map((tier) => (
                    <li key={tier.tierKey} className="fq-tier" data-recommended={tier.recommended}>
                      <div className="fq-tier-head">
                        <span className="fq-tier-key">{tier.tierKey} · {tier.customerName}</span>
                        {/* AllSeason's Better tier is itself named "Recommended"; don't say it twice. */}
                        {tier.recommended && !/recommended/i.test(tier.customerName)
                          ? <span className="fq-tier-badge">Recommended</span>
                          : null}
                      </div>
                      <p className="fq-tier-price">{range(tier.rangeLowCents, tier.rangeHighCents)}</p>
                      <p className="fq-tier-detail">{tier.warrantySummary}</p>
                    </li>
                  ))}
                </ol>
              ) : ready ? (
                <p className="quiet-price">
                  {money.format(ready.lowCents / 100)} <span>to</span> {money.format(ready.highCents / 100)}
                </p>
              ) : null}
              {/* With the tiers, the roof size moves into the fine print to keep booking close. */}
              {tiers ? null : <p className="quiet-lede">{lede}</p>}

              {booked && booking ? (
                <div className="fq-section">
                  <p className="quiet-step">Your video call</p>
                  <p className="fq-booked-time">{formatMeetingTime(booked.startsAt, booking.model.timezone)}</p>
                  <button type="button" className="quiet-secondary quiet-cta" onClick={() => setStage({name: "booked"})}>
                    {remaining.length > 0 ? "See your call and finish getting ready" : "See your call details"}
                  </button>
                </div>
              ) : canBook ? (
                <>
                  <button type="button" className="quiet-submit quiet-cta" onClick={startBooking}>
                    Pick a video call time
                  </button>
                  <p className="fq-cta-note">
                    {booking?.model.durationMinutes ?? 30} minutes on Google Meet with a specialist. No home visit needed.
                  </p>
                </>
              ) : (
                <button type="button" className="quiet-submit quiet-cta" onClick={() => setStage({name: "callback"})}>
                  Have a specialist call me
                </button>
              )}
              <a href={brand.phoneHref} className="quiet-back quiet-inline-link fq-call">Or call {brand.phoneDisplay}</a>
              {ready ? (
                <p className="quiet-notice quiet-fine">
                  {tiers ? `${lede} ` : null}
                  Preliminary sales estimate only. Decking, tear-off layers, access, permits, and field conditions can change the final proposal.
                </p>
              ) : null}
            </div>
          </div>
        </Screen>
      );
    }

    case "owner":
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Before we book</p>
          <Title>Do you own this home?</Title>
          <Options items={ownershipOptions} label="Do you own this home?" disabled={busy} onPick={chooseOwnership} />
          <TextButton disabled={busy} onClick={go({name: "quote"})}>Back</TextButton>
        </Screen>
      );

    case "renter":
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Thanks for letting us know</p>
          <Title>Let’s start with a call.</Title>
          <p className="quiet-lede">
            The owner signs off on a roof project, so a specialist will call you first to talk it through. When’s a good time?
          </p>
          {callWindowOptions}
          <button type="button" className="quiet-back" onClick={notNow} disabled={busy}>Not now</button>
        </Screen>
      );

    case "callback":
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Talk to a specialist</p>
          <Title>When’s a good time to call?</Title>
          {callWindowOptions}
          <div className="fq-actions">
            {days.length > 0 ? <TextButton disabled={busy} onClick={go({name: "days"})}>Pick a video call time instead</TextButton> : null}
            <TextButton disabled={busy} onClick={go({name: "quote"})}>Back to my estimate</TextButton>
          </div>
        </Screen>
      );

    case "ended":
      return (
        <Screen brand={brand} alert={alert}>
          <Title>{stage.title}</Title>
          <p className="quiet-lede">{stage.body}</p>
          <a href={brand.phoneHref} className="quiet-secondary quiet-link-button quiet-cta">Call {brand.phoneDisplay}</a>
          <TextButton disabled={busy} onClick={go({name: "quote"})}>Back to my estimate</TextButton>
        </Screen>
      );

    case "days": {
      const minutes = booking?.model.durationMinutes ?? 30;
      if (!bookingLoaded) {
        return (
          <Screen brand={brand} alert={alert}>
            <p className="quiet-step">Video call · {minutes} minutes</p>
            <Title>Pick a day.</Title>
            <p className="quiet-lede" role="status">Loading open times…</p>
          </Screen>
        );
      }
      if (days.length === 0) {
        return (
          <Screen brand={brand} alert={alert}>
            <p className="quiet-step">Video call</p>
            <Title>No open times right now.</Title>
            <p className="quiet-lede">A specialist can call you instead. When’s a good time?</p>
            {callWindowOptions}
            <TextButton disabled={busy} onClick={go({name: "quote"})}>Back to my estimate</TextButton>
          </Screen>
        );
      }
      const visible = showAllDays ? days : days.slice(0, VISIBLE_DAYS);
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Video call · {minutes} minutes</p>
          <Title>Pick a day.</Title>
          <div className="quiet-options" role="group" aria-label="Days with open times">
            {visible.map((day) => (
              <button key={day.date} type="button" className="quiet-option" onClick={() => setStage({name: "times", date: day.date})}>
                {dayLong.format(noonUtc(day.date))}
              </button>
            ))}
            {!showAllDays && days.length > VISIBLE_DAYS ? (
              <button type="button" className="quiet-option fq-option-quiet" onClick={() => setShowAllDays(true)}>Later dates</button>
            ) : null}
          </div>
          <div className="fq-actions">
            <TextButton disabled={busy} onClick={go({name: "callback"})}>Have someone call me instead</TextButton>
            <TextButton disabled={busy} onClick={go({name: "quote"})}>Back to my estimate</TextButton>
          </div>
        </Screen>
      );
    }

    case "times": {
      const day = days.find((item) => item.date === stage.date);
      const timezone = booking?.model.timezone ?? "America/New_York";
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">{dayLong.format(noonUtc(stage.date))}</p>
          <Title>Pick a time.</Title>
          <p className="quiet-lede">Times are Eastern.</p>
          <div className="quiet-options" role="group" aria-label="Open times">
            {(day?.slots ?? []).map((slot: Slot) => (
              <button
                key={slot.startsAt}
                type="button"
                className="quiet-option"
                onClick={() => setStage({name: "confirm", startsAt: slot.startsAt, otherEmail: false})}
              >
                {formatClockTime(slot.startsAt, timezone)}
              </button>
            ))}
          </div>
          <TextButton disabled={busy} onClick={go({name: "days"})}>Pick another day</TextButton>
        </Screen>
      );
    }

    case "confirm": {
      if (!booking) return null;
      const when = formatMeetingTime(stage.startsAt, booking.model.timezone);
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Confirm your video call</p>
          <Title>{when}</Title>
          {stage.otherEmail ? (
            <form onSubmit={(event) => submitOtherEmail(event, stage.startsAt)} className="quiet-form" noValidate>
              <label className="quiet-field">
                Email for the invite
                <input name="attendeeEmail" type="email" inputMode="email" autoComplete="email" required className="quiet-input" />
              </label>
              <button type="submit" disabled={busy} className="quiet-submit">{busy ? "Booking…" : "Book it"}</button>
              <button type="button" className="quiet-back" onClick={() => setStage({...stage, otherEmail: false})}>
                Use {booking.model.inviteEmail} instead
              </button>
            </form>
          ) : (
            <>
              <p className="quiet-lede">We’ll send the Google Meet invite to {booking.model.inviteEmail}.</p>
              <button type="button" className="quiet-submit quiet-cta" disabled={busy} onClick={() => void book(stage.startsAt)}>
                {busy ? "Booking…" : "Book it"}
              </button>
              <button type="button" className="quiet-secondary quiet-cta" disabled={busy} onClick={() => setStage({...stage, otherEmail: true})}>
                Send the invite to a different email
              </button>
            </>
          )}
          <TextButton disabled={busy} onClick={go({name: "days"})}>Pick another time</TextButton>
        </Screen>
      );
    }

    case "booked": {
      if (!booking || !booked) return null;
      const count = remaining.length;
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">You’re booked</p>
          <Title>{formatMeetingTime(booked.startsAt, booking.model.timezone)}</Title>
          <BookedDetails booking={booking} brand={brand} />
          {count > 0 ? (
            <div className="fq-section">
              <h2 className="fq-subheading">Help us speed up your meeting</h2>
              <p className="quiet-lede">
                Answer {count === 1 ? "one quick question" : `these ${count} quick questions`} so your specialist comes ready with the right options.
              </p>
              <button type="button" className="quiet-submit quiet-cta" disabled={busy} onClick={startPrep}>
                {busy ? "One moment…" : count === 1 ? "Answer 1 quick question" : `Answer ${count} quick questions`}
              </button>
              <button type="button" className="quiet-back" disabled={busy} onClick={() => setStage({name: "done", answered: false})}>
                Skip for now
              </button>
            </div>
          ) : (
            <TextButton disabled={busy} onClick={go({name: "quote"})}>Back to my estimate</TextButton>
          )}
        </Screen>
      );
    }

    case "prep": {
      if (!assessment) return null;
      const step = PREP_STEPS[stage.step];
      const responses = {...mergedResponses(assessment, ownership), ...draft};
      const position = Math.max(prepPlan.indexOf(stage.step), 0) + 1;
      const total = Math.max(prepPlan.length, position);
      const single = SINGLE_OPTIONS[step.id];
      let body: ReactNode;
      if (single) {
        body = (
          <Options
            items={single}
            label={assessmentQuestionTitles[step.id]}
            disabled={busy}
            onPick={(option) => answer({[step.responseKeys[0]]: option.value} as Responses)}
          />
        );
      } else if (step.id === "conditionSignals" || step.id === "complexityFeatures") {
        const key = step.id;
        const items = key === "conditionSignals" ? conditionOptions : complexityOptions;
        const exclusive = key === "conditionSignals" ? ["nothing_obvious", "unsure"] : ["none_or_unsure"];
        const selected = (responses[key] ?? []) as string[];
        const chosen = (draft[key] ?? []) as string[];
        body = (
          <>
            <p className="quiet-lede">Pick all that apply.</p>
            <div className="quiet-options" role="group" aria-label={assessmentQuestionTitles[step.id]}>
              {items.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="quiet-option fq-check"
                  aria-pressed={selected.includes(option.value)}
                  disabled={busy}
                  onClick={() => setDraft({...draft, [key]: toggle(chosen, option.value, exclusive)})}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="quiet-submit quiet-cta"
              disabled={busy || chosen.length === 0}
              onClick={() => answer({[key]: chosen} as Responses)}
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </>
        );
      } else {
        body = (
          <>
            <Options
              items={YES_NO}
              label={assessmentQuestionTitles[step.id]}
              disabled={busy}
              onPick={(option) => answer(option.value === "no"
                ? {roofVisible: "no", visibleCondition: "not_answered"}
                : {roofVisible: "yes", visibleCondition: undefined})}
            />
            {draft.roofVisible === "yes" ? (
              <>
                <p className="fq-follow-up">Which looks closest from the ground?</p>
                <Options
                  items={VISIBLE_CONDITION_OPTIONS}
                  label="Which looks closest from the ground?"
                  disabled={busy}
                  onPick={(option) => answer({
                    roofVisible: "yes",
                    visibleCondition: option.value as RoofAssessmentResponses["visibleCondition"],
                  })}
                />
              </>
            ) : null}
          </>
        );
      }
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">Question {position} of {total}</p>
          <Title>{assessmentQuestionTitles[step.id]}</Title>
          {body}
          <button type="button" className="quiet-back" disabled={busy} onClick={() => setStage({name: "done", answered: false})}>
            Skip the rest
          </button>
        </Screen>
      );
    }

    case "done":
      return (
        <Screen brand={brand} alert={alert}>
          <p className="quiet-step">{stage.answered ? "Thank you" : "You’re all set"}</p>
          <Title>{stage.answered ? "Your specialist will be ready." : "See you on the call."}</Title>
          {booking && booked ? (
            <>
              <p className="fq-booked-time">{formatMeetingTime(booked.startsAt, booking.model.timezone)}</p>
              <BookedDetails booking={booking} brand={brand} />
            </>
          ) : null}
          <TextButton disabled={busy} onClick={go({name: "quote"})}>Back to my estimate</TextButton>
        </Screen>
      );
  }
}
