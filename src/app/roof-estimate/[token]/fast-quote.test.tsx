import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import {roofAssessmentQuestionSteps, type RoofAssessmentResponses} from "@/domain/roof-assessment";
import type {BookingPageModel, BookingSummary} from "@/modules/booking/booking-service";
import type {ChatEstimateSummary} from "@/modules/quote-chat/types";
import {FastQuote} from "./fast-quote";
import type {AssessmentSnapshot, FastQuoteApi} from "./fast-quote-api";
import type {QuietEstimateState} from "./public-estimate-flow";

const token = "55555555-5555-4555-8555-555555555555";
const bookingToken = "link.signature";
const address = "18 Harbor View Dr, Red Bank, NJ 07701, USA";
const brand = {name: "AllSeason Solar", phoneDisplay: "(866) 835-6022", phoneHref: "tel:+18668356022"};

const tiers = [
  {tierKey: "good", customerName: "Landmark system", warrantySummary: "SureStart PLUS warranty", rangeLowCents: 1_200_000, rangeHighCents: 1_600_000, recommended: false},
  {tierKey: "better", customerName: "Landmark Pro system", warrantySummary: "Landmark Pro warranty", rangeLowCents: 1_400_000, rangeHighCents: 2_100_000, recommended: true},
  {tierKey: "best", customerName: "Presidential system", warrantySummary: "Integrity warranty", rangeLowCents: 1_900_000, rangeHighCents: 2_600_000, recommended: false},
];
const readyState: QuietEstimateState = {kind: "ready", lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28, packages: tiers};
const ready = {pending: false, state: readyState};
const pending = {pending: true, state: {kind: "received"} as QuietEstimateState};
const asSummary = (value: {pending: boolean; state: QuietEstimateState}): ChatEstimateSummary => ({...value, address});

const openModel: Extract<BookingPageModel, {kind: "open" | "booked"}> = {
  kind: "open",
  firstName: "Jordan",
  inviteEmail: "j•••@example.com",
  supportPhone: null,
  meetingTitle: "Roof consultation",
  durationMinutes: 30,
  timezone: "America/New_York",
  days: [
    {date: "2026-10-26", weekday: 1, slots: [
      {startsAt: "2026-10-26T14:00:00.000Z", minuteOfDay: 600},
      {startsAt: "2026-10-26T14:30:00.000Z", minuteOfDay: 630},
    ]},
    {date: "2026-10-27", weekday: 2, slots: []},
  ],
  booking: null,
};
const booked: BookingSummary = {
  appointmentId: "66666666-6666-4666-8666-666666666666",
  startsAt: "2026-10-26T14:30:00.000Z",
  endsAt: "2026-10-26T15:00:00.000Z",
  durationMinutes: 30,
  meetingUrl: null,
  calendarReady: true,
  inviteEmail: "j•••@example.com",
  canChange: true,
};

/** A small stand-in for the assessment endpoints with the server's ordering rules. */
function fakeAssessment(initial: Partial<AssessmentSnapshot> = {}) {
  const state: AssessmentSnapshot = {
    revision: 3,
    status: "in_progress",
    currentStep: 2,
    responses: {reason: "roof_age", roofAge: "15_20", timeline: "this_season"},
    ...initial,
  };
  const saves: Array<{questionId: string; complete: boolean; patch: Partial<RoofAssessmentResponses>}> = [];
  const snapshot = () => ({...state, responses: {...state.responses}});
  const api: Pick<FastQuoteApi, "loadAssessment" | "saveAnswer" | "saveOwnership"> = {
    loadAssessment: vi.fn(async () => snapshot()),
    saveOwnership: vi.fn(async (_token, ownership) => {
      state.responses = {...state.responses, ownership};
      state.revision += 1;
      return true;
    }),
    saveAnswer: vi.fn(async (_token, input) => {
      if (input.expectedRevision !== state.revision) return {kind: "conflict" as const, assessment: snapshot()};
      const index = roofAssessmentQuestionSteps.findIndex((step) => step.id === input.questionId);
      if (input.complete !== (index === roofAssessmentQuestionSteps.length - 1)) return {kind: "failed" as const};
      if (index + 1 > state.currentStep + 1) return {kind: "conflict" as const, assessment: snapshot()};
      saves.push({questionId: input.questionId, complete: input.complete, patch: input.responsePatch});
      state.responses = {...state.responses, ...input.responsePatch};
      state.currentStep = Math.max(state.currentStep, index + 1);
      state.revision += 1;
      if (input.complete) state.status = "completed";
      return {kind: "saved" as const, assessment: snapshot()};
    }),
  };
  return {state, saves, api};
}

function fakeApi(overrides: Partial<FastQuoteApi> = {}, assessment = fakeAssessment()) {
  const api: FastQuoteApi = {
    loadEstimate: vi.fn(async () => asSummary(ready)),
    bookingLink: vi.fn(async () => bookingToken),
    bookingOverview: vi.fn(async () => openModel),
    book: vi.fn(async () => ({kind: "booked" as const, booking: booked})),
    requestCallback: vi.fn(async () => true),
    ...assessment.api,
    ...overrides,
  };
  return {api, assessment};
}

function renderQuote(api: FastQuoteApi, props: Partial<Parameters<typeof FastQuote>[0]> = {}) {
  return render(
    <FastQuote
      token={token}
      address={address}
      brand={brand}
      initial={ready}
      animate
      bookingAvailable
      api={api}
      phaseMs={1}
      holdMs={50}
      pollMs={1}
      latePollMs={1}
      {...props}
    />,
  );
}

const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", {name}));
const heading = () => screen.getByRole("heading", {level: 1}).textContent;
const pressed = (name: string | RegExp) => screen.getByRole("button", {name}).getAttribute("aria-pressed");

async function bookACall() {
  await screen.findByRole("heading", {name: "Your estimate is ready."});
  tap("Yes, I own it");
  await screen.findByRole("button", {name: "Monday, October 26"});
  tap("10:30 AM");
  tap("Confirm Mon, Oct 26 at 10:30 AM");
  await screen.findByText("You’re booked");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fast quote", () => {
  test("runs the four phases, then shows the price card with booking on the same screen", async () => {
    const {api} = fakeApi();
    renderQuote(api);
    expect(heading()).toBe("Preparing your estimate.");
    expect(screen.getByRole("status")).toHaveTextContent("Confirming your address");

    await screen.findByRole("heading", {name: "Your estimate is ready."});
    expect(document.querySelector(".fq-card-range")?.textContent).toBe("$12,000 to $26,000");
    const options = screen.getByRole("list", {name: "Your three options"});
    const rows = within(options).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Good · Landmark system$12,000 to $16,000SureStart PLUS warranty",
      "Better · Landmark Pro systemRecommended$14,000 to $21,000Landmark Pro warranty",
      "Best · Presidential system$19,000 to $26,000Integrity warranty",
    ]);
    expect(screen.getByText(/About 28\.0 roofing squares/)).toBeInTheDocument();
    expect(screen.getByRole("heading", {level: 2, name: "Lock it in on a 30-minute video call"})).toBeInTheDocument();
    expect(screen.getByRole("group", {name: "Do you own this home?"})).toBeInTheDocument();
    // The calendar waits for the ownership answer.
    expect(screen.queryByRole("group", {name: "Pick a day"})).toBeNull();
    expect(screen.getByRole("link", {name: "Or call (866) 835-6022"})).toHaveAttribute("href", brand.phoneHref);
    // Booking times are loaded while the phases run.
    expect(api.bookingLink).toHaveBeenCalledWith(token);
  });

  test("holds on the last phase until the price lands", async () => {
    let calls = 0;
    const {api} = fakeApi({loadEstimate: vi.fn(async () => asSummary(++calls < 3 ? pending : ready))});
    renderQuote(api, {initial: pending, holdMs: 5_000});
    await screen.findByRole("heading", {name: "Your estimate is ready."});
    expect(api.loadEstimate).toHaveBeenCalledTimes(3);
  });

  test("stops holding after the limit and lets the homeowner book while pricing finishes", async () => {
    let late = false;
    const {api} = fakeApi({loadEstimate: vi.fn(async () => asSummary(late ? ready : pending))});
    renderQuote(api, {initial: pending, holdMs: 5, latePollMs: 20});
    await screen.findByRole("heading", {name: "Your estimate is almost ready."});
    expect(screen.getByRole("button", {name: "Yes, I own it"})).toBeInTheDocument();
    late = true;
    await screen.findByRole("heading", {name: "Your estimate is ready."});
  });

  test("skips the phases when the homeowner reopens the estimate later", () => {
    const {api} = fakeApi();
    renderQuote(api, {animate: false});
    expect(heading()).toBe("Your estimate is ready.");
  });

  test("does not repeat Recommended when the tier is named that", () => {
    const {api} = fakeApi();
    const named = tiers.map((tier) => tier.tierKey === "better" ? {...tier, customerName: "Recommended"} : tier);
    renderQuote(api, {animate: false, initial: {pending: false, state: {...readyState, packages: named}}});
    expect(screen.getAllByText(/Recommended/)).toHaveLength(1);
  });

  test("shows a single range when the estimate has no tiers", () => {
    const {api} = fakeApi();
    renderQuote(api, {animate: false, initial: {pending: false, state: {kind: "ready", lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28}}});
    expect(screen.queryByRole("list", {name: "Your three options"})).toBeNull();
    expect(document.querySelector(".quiet-price")?.textContent).toBe("$14,000 to $21,000");
  });

  test("offers booking even when a specialist has to confirm the measurement", () => {
    const {api} = fakeApi();
    renderQuote(api, {animate: false, initial: {pending: false, state: {kind: "review"}}});
    expect(heading()).toBe("A specialist will confirm your roof.");
    expect(screen.getByRole("button", {name: "Yes, I own it"})).toBeInTheDocument();
  });

  test("asks about ownership, then books a video call without leaving the price", async () => {
    const {api} = fakeApi();
    renderQuote(api);
    await screen.findByRole("heading", {name: "Your estimate is ready."});
    tap("Yes, I own it");
    expect(pressed("Yes, I own it")).toBe("true");
    // The first open day is picked; the confirm button waits for a time.
    expect(await screen.findByRole("button", {name: "Monday, October 26"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name: "Pick a time to confirm"})).toBeDisabled();
    expect(screen.getByText(/We’ll send the Google Meet invite to j•••@example\.com/)).toBeInTheDocument();
    tap("10:30 AM");
    expect(pressed("10:30 AM")).toBe("true");
    tap("Confirm Mon, Oct 26 at 10:30 AM");
    await screen.findByText("You’re booked");

    expect(api.saveOwnership).toHaveBeenCalledWith(token, "owner");
    expect(api.book).toHaveBeenCalledWith(bookingToken, {startsAt: "2026-10-26T14:30:00.000Z"});
    expect(heading()).toBe("Monday, October 26 at 10:30 AM EDT");
    expect(screen.getByRole("link", {name: "Add to calendar"})).toHaveAttribute("href", `/api/booking/${bookingToken}/calendar`);
    expect(screen.getByRole("link", {name: "Change or cancel"})).toHaveAttribute("href", `/book/${bookingToken}`);
    expect(await screen.findByRole("heading", {name: "Help us speed up your meeting"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Answer 5 quick questions"})).toBeInTheDocument();
  });

  test("sends the invite to a different email when asked", async () => {
    const {api} = fakeApi();
    renderQuote(api, {animate: false});
    tap("Yes, I own it");
    await screen.findByRole("button", {name: "Monday, October 26"});
    tap("10:00 AM");
    tap("Use a different email");
    fireEvent.change(screen.getByLabelText("Email for the invite"), {target: {value: "sam@example.com"}});
    tap("Confirm Mon, Oct 26 at 10:00 AM");
    await screen.findByText("You’re booked");
    expect(api.book).toHaveBeenCalledWith(bookingToken, {startsAt: "2026-10-26T14:00:00.000Z", attendeeEmail: "sam@example.com"});
  });

  test("opens the calendar straight away when ownership was answered on an earlier visit", async () => {
    const {api} = fakeApi({}, fakeAssessment({responses: {reason: "roof_age", roofAge: "15_20", timeline: "this_season", ownership: "buying"}}));
    renderQuote(api, {animate: false});
    expect(await screen.findByRole("button", {name: "Monday, October 26"})).toBeInTheDocument();
    expect(pressed("I'm buying it")).toBe("true");
    expect(api.saveOwnership).not.toHaveBeenCalled();
  });

  test("offers a renter a call instead of the calendar, on the same screen", async () => {
    const {api} = fakeApi();
    renderQuote(api);
    await screen.findByRole("heading", {name: "Your estimate is ready."});
    tap("No");
    expect(await screen.findByText(/The owner signs off on a roof project/)).toBeInTheDocument();
    expect(screen.queryByRole("group", {name: "Pick a day"})).toBeNull();
    expect(api.saveOwnership).toHaveBeenCalledWith(token, "not_owner");
    tap("Morning (9 to 12)");
    await screen.findByRole("heading", {name: "We’ll call you in the morning."});
    expect(api.requestCallback).toHaveBeenCalledWith(token, "morning");
    expect(api.book).not.toHaveBeenCalled();
  });

  test("lets buyers and property managers book", async () => {
    for (const label of ["I'm buying it", "I manage it"]) {
      const {api} = fakeApi();
      const view = renderQuote(api, {animate: false});
      tap(label);
      await screen.findByRole("button", {name: "Monday, October 26"});
      view.unmount();
    }
  });

  test("offers a call on the same screen when there are no open times", async () => {
    const {api} = fakeApi({bookingOverview: vi.fn(async () => ({...openModel, days: [{date: "2026-10-27" as const, weekday: 2, slots: []}]}))});
    renderQuote(api, {animate: false});
    expect(await screen.findByRole("heading", {level: 2, name: "Talk it through with a specialist"})).toBeInTheDocument();
    expect(screen.queryByRole("group", {name: "Do you own this home?"})).toBeNull();
    tap("Evening (5 to 8)");
    await screen.findByRole("heading", {name: "We’ll call you in the early evening."});
  });

  test("asks the remaining questions after booking, in order, and finishes the assessment", async () => {
    const {api, assessment} = fakeApi();
    renderQuote(api);
    await bookACall();
    tap(await screen.findByRole("button", {name: "Answer 5 quick questions"}).then((button) => button.textContent!));

    expect(await screen.findByRole("heading", {name: "Have you noticed any of these?"})).toBeInTheDocument();
    expect(screen.getByText("Question 1 of 5")).toBeInTheDocument();
    tap("Shingles curling or cracking");
    tap("Granules in gutters");
    expect(screen.getByRole("button", {name: "Granules in gutters"})).toHaveAttribute("aria-pressed", "true");
    tap("Continue");

    await screen.findByRole("heading", {name: "Can you see your roof from the ground?"});
    expect(screen.getByText("Question 2 of 5")).toBeInTheDocument();
    tap("Yes");
    tap(await screen.findByRole("button", {name: "Moderate wear"}).then((button) => button.textContent!));

    await screen.findByRole("heading", {name: "Quick property check"});
    tap("Two-story home");
    await screen.findByRole("heading", {name: "Any sections like these?"});
    tap("Garage");
    tap("Continue");
    await screen.findByRole("heading", {name: "What would make the project feel like the right decision?"});
    expect(screen.getByText("Question 5 of 5")).toBeInTheDocument();
    tap("Strongest long-term warranty");

    await screen.findByRole("heading", {name: "Your specialist will be ready."});
    expect(assessment.saves).toEqual([
      {questionId: "conditionSignals", complete: false, patch: {conditionSignals: ["curling_or_cracking", "granules"]}},
      {questionId: "roofVisibility", complete: false, patch: {roofVisible: "yes", visibleCondition: "moderate_wear"}},
      {questionId: "stories", complete: false, patch: {stories: "two"}},
      {questionId: "complexityFeatures", complete: false, patch: {complexityFeatures: ["garage"]}},
      {questionId: "priority", complete: false, patch: {priority: "long_warranty"}},
      // Answered earlier, confirmed on the way past without asking again.
      {questionId: "timeline", complete: false, patch: {timeline: "this_season"}},
      {questionId: "ownership", complete: true, patch: {ownership: "owner"}},
    ]);
    expect(assessment.state.status).toBe("completed");
  });

  test("can skip the questions and still sees the booked call", async () => {
    const {api, assessment} = fakeApi();
    renderQuote(api);
    await bookACall();
    tap(await screen.findByRole("button", {name: "Skip for now"}).then((button) => button.textContent!));
    await screen.findByRole("heading", {name: "See you on the call."});
    expect(screen.getByText("Monday, October 26 at 10:30 AM EDT")).toBeInTheDocument();
    expect(assessment.saves).toEqual([]);
  });

  test("hides the questions when the assessment is no longer open", async () => {
    const {api} = fakeApi({}, fakeAssessment({status: "abandoned"}));
    renderQuote(api);
    await bookACall();
    await waitFor(() => expect(api.loadAssessment).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", {name: "Help us speed up your meeting"})).toBeNull();
  });

  test("stays on the price with fresh times when the time was just taken", async () => {
    const {api} = fakeApi({book: vi.fn(async () => ({kind: "taken" as const}))});
    renderQuote(api, {animate: false});
    tap("Yes, I own it");
    await screen.findByRole("button", {name: "Monday, October 26"});
    tap("10:00 AM");
    tap("Confirm Mon, Oct 26 at 10:00 AM");
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("That time was just taken");
    expect(heading()).toBe("Your estimate is ready.");
    expect(screen.getByRole("button", {name: "Pick a time to confirm"})).toBeDisabled();
  });

  test("offers a callback when online booking is off", async () => {
    const {api} = fakeApi();
    renderQuote(api, {animate: false, bookingAvailable: false});
    expect(screen.queryByRole("group", {name: "Do you own this home?"})).toBeNull();
    expect(screen.getByRole("heading", {level: 2, name: "Talk it through with a specialist"})).toBeInTheDocument();
    tap("As soon as possible");
    await screen.findByRole("heading", {name: "We’ll call you as soon as possible during business hours."});
    expect(api.bookingLink).not.toHaveBeenCalled();
  });

  test("shows an existing booking instead of the calendar", async () => {
    const {api} = fakeApi({bookingOverview: vi.fn(async () => ({...openModel, kind: "booked" as const, booking: booked}))});
    renderQuote(api, {animate: false});
    expect(await screen.findByText("Monday, October 26 at 10:30 AM EDT")).toBeInTheDocument();
    expect(screen.queryByRole("group", {name: "Do you own this home?"})).toBeNull();
    tap("See your call and finish getting ready");
    expect(heading()).toBe("Monday, October 26 at 10:30 AM EDT");
  });

  test("lets the homeowner leave without booking", async () => {
    const {api} = fakeApi();
    renderQuote(api, {animate: false});
    tap("Not ready to book yet?");
    expect(heading()).toBe("No problem.");
    expect(api.book).not.toHaveBeenCalled();
  });
});
