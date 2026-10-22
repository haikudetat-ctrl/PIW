import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import type {BookingPageModel, BookingSummary} from "@/modules/booking/booking-service";
import {contactOnlyNotice} from "@/modules/property-preview/notices";
import type {PreviewView} from "@/modules/property-preview/preview-read-model";
import type {ChatApi} from "./chat-api";
import {QuoteChat} from "./quote-chat";

const trackConversion = vi.fn();
vi.mock("@/components/marketing/meta-pixel-provider", () => ({
  useMetaPixel: () => ({trackConversion}),
}));

const token = "t".repeat(43);
const estimateToken = "55555555-5555-4555-8555-555555555555";
const bookingToken = "link.signature";
const brand = {name: "All Season Solar", phoneDisplay: "(856) 835-6022", phoneHref: "tel:+18568356022"};
const view: PreviewView = {
  status: "active",
  address: {display: "18 Harbor View Dr, Red Bank, NJ 07701, USA", googleConfirmed: true},
  image: {state: "ready"},
  roof: {state: "ready", squares: 28, complexity: "moderate"},
  answered: [],
  savedEmail: false,
  campaign: null,
  presentationKey: "all-season-main",
  metaEventId: "88888888-8888-4888-8888-888888888888",
};
const openModel: Extract<BookingPageModel, {kind: "open" | "booked"}> = {
  kind: "open",
  firstName: "Jordan",
  inviteEmail: "j•••@example.com",
  supportPhone: null,
  meetingTitle: "Roof consultation",
  durationMinutes: 30,
  timezone: "America/New_York",
  days: [
    {date: "2026-10-21", weekday: 3, slots: [
      {startsAt: "2026-10-21T14:00:00.000Z", minuteOfDay: 600},
      {startsAt: "2026-10-21T14:30:00.000Z", minuteOfDay: 630},
    ]},
    {date: "2026-10-22", weekday: 4, slots: []},
  ],
  booking: null,
};
const booked: BookingSummary = {
  appointmentId: "66666666-6666-4666-8666-666666666666",
  startsAt: "2026-10-21T14:30:00.000Z",
  endsAt: "2026-10-21T15:00:00.000Z",
  durationMinutes: 30,
  meetingUrl: null,
  calendarReady: false,
  inviteEmail: "j•••@example.com",
  canChange: true,
};

function fakeApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    loadPreview: vi.fn(async () => view),
    answer: vi.fn(),
    beacon: vi.fn(),
    convert: vi.fn(async () => ({kind: "accepted" as const, continuationPath: "/roof-estimate/continue/abc", metaEvent: null})),
    continueToEstimate: vi.fn(async () => ({kind: "estimate" as const, estimateToken})),
    loadEstimate: vi.fn(async () => ({
      pending: false,
      state: {kind: "ready" as const, lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28},
      address: view.address.display,
    })),
    bookingLink: vi.fn(async () => bookingToken),
    bookingOverview: vi.fn(async () => openModel),
    book: vi.fn(async () => ({kind: "booked" as const, booking: booked})),
    requestCallback: vi.fn(async () => true),
    ...overrides,
  };
}

function renderChat(api: ChatApi, overrides: Partial<PreviewView> = {}, bookingAvailable = true) {
  return render(
    <QuoteChat
      token={token}
      initialView={{...view, ...overrides}}
      brand={brand}
      privacyUrl="https://allseasonroofingquote.com/privacy.html"
      bookingAvailable={bookingAvailable}
      api={api}
      aerialLoader={async () => ({kind: "ready", objectUrl: "blob:aerial"})}
      pollMs={1}
    />,
  );
}

const log = () => screen.getByRole("log");
const priceCard = async () => (await screen.findByRole("region", {name: "Your estimate"})).textContent;
const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", {name}));

async function answerQuestions() {
  tap("Roof is getting old");
  tap("15–20 years");
  tap("This season");
}

async function submitContact() {
  fireEvent.change(screen.getByLabelText("Full name"), {target: {value: "Jordan Rivera"}});
  fireEvent.change(screen.getByLabelText("Email"), {target: {value: "jordan@example.com"}});
  fireEvent.change(screen.getByLabelText("Mobile phone"), {target: {value: "6095550101"}});
  tap("Unlock my price");
}

beforeEach(() => {
  trackConversion.mockClear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("quote chat", () => {
  test("picks up after the website's address question with the roof and the first question", async () => {
    const api = fakeApi();
    renderChat(api);
    expect(within(log()).getByText("What’s the address of the home?")).toBeTruthy();
    expect(within(log()).getByText(view.address.display)).toBeTruthy();
    expect(await screen.findByText("About 28 roofing squares, a moderately complex roof.")).toBeTruthy();
    expect(within(log()).getByText("What made you check your roof today?")).toBeTruthy();
    expect(api.beacon).toHaveBeenCalledWith(token, "revealed");
    await waitFor(() => expect(trackConversion).toHaveBeenCalledWith(expect.objectContaining({name: "RoofPreviewStarted"})));
  });

  test("records each answer and asks for contact details under the same notice as the preview page", async () => {
    const api = fakeApi();
    renderChat(api);
    await answerQuestions();
    expect(api.answer).toHaveBeenCalledWith(token, "reason", "roof_age");
    expect(api.answer).toHaveBeenCalledWith(token, "roofAge", "15_20");
    expect(api.answer).toHaveBeenCalledWith(token, "timeline", "this_season");
    expect(screen.getByTestId("chat-contact-notice").textContent).toContain(contactOnlyNotice("All Season Solar"));
    expect(screen.getByRole("button", {name: "Unlock my price"})).toBeTruthy();
    expect(api.beacon).toHaveBeenCalledWith(token, "contact_viewed");
  });

  test("skips questions the homeowner already answered", () => {
    renderChat(fakeApi(), {answered: ["reason", "roofAge", "timeline"]});
    expect(screen.getByLabelText("Full name")).toBeTruthy();
  });

  test("shows the price, then books a video call in the conversation", async () => {
    const api = fakeApi();
    renderChat(api);
    await answerQuestions();
    await submitContact();

    expect(await priceCard()).toContain("$14,000 to $21,000");
    expect(api.convert).toHaveBeenCalledWith(token, expect.objectContaining({name: "Jordan Rivera", email: "jordan@example.com", phone: "6095550101"}));
    expect(api.continueToEstimate).toHaveBeenCalledWith("/roof-estimate/continue/abc");
    expect(window.sessionStorage.getItem(`quote-chat:${token}`)).toContain(estimateToken);

    tap("Wed, Oct 21");
    expect(screen.queryByRole("button", {name: "Thu, Oct 22"})).toBeNull();
    tap("10:30 AM");
    expect(within(log()).getByText("Wednesday, October 21 at 10:30 AM EDT. I’ll send the Google invite to j•••@example.com.")).toBeTruthy();
    tap("Book it");

    expect(await screen.findByText("You’re booked.")).toBeTruthy();
    expect(api.book).toHaveBeenCalledWith(bookingToken, {startsAt: "2026-10-21T14:30:00.000Z"});
    expect(screen.getByRole("link", {name: "Add to calendar"}).getAttribute("href")).toBe(`/api/booking/${encodeURIComponent(bookingToken)}/calendar`);
    expect(screen.getByText(/The Google invite with the Meet link is on its way/)).toBeTruthy();
  });

  test("sends the invite to a different email when asked", async () => {
    const api = fakeApi();
    renderChat(api);
    await answerQuestions();
    await submitContact();
    tap(await screen.findByRole("button", {name: "Wed, Oct 21"}).then((button) => button.textContent!));
    tap("10:00 AM");
    tap("Send it to a different email");
    fireEvent.change(screen.getByLabelText("Email for the invite"), {target: {value: "sam@example.com"}});
    tap("Book it");
    await waitFor(() => expect(api.book).toHaveBeenCalledWith(bookingToken, {startsAt: "2026-10-21T14:00:00.000Z", attendeeEmail: "sam@example.com"}));
  });

  test("offers fresh times when the slot was just taken", async () => {
    const api = fakeApi({book: vi.fn(async () => ({kind: "taken" as const}))});
    renderChat(api);
    await answerQuestions();
    await submitContact();
    tap(await screen.findByRole("button", {name: "Wed, Oct 21"}).then((button) => button.textContent!));
    tap("10:00 AM");
    tap("Book it");
    expect(await screen.findByText("That time was just taken. Here are the open days now.")).toBeTruthy();
    expect(screen.getByRole("button", {name: "Wed, Oct 21"})).toBeTruthy();
  });

  test("takes a callback request instead of a booking", async () => {
    const api = fakeApi();
    renderChat(api);
    await answerQuestions();
    await submitContact();
    tap(await screen.findByRole("button", {name: "Have someone call me"}).then((button) => button.textContent!));
    tap("Afternoon (12 to 5)");
    expect(await screen.findByText("Got it. Someone from All Season Solar will call you in the afternoon.")).toBeTruthy();
    expect(api.requestCallback).toHaveBeenCalledWith(estimateToken, "afternoon");
  });

  test("goes straight to a callback when online booking is off", async () => {
    const api = fakeApi();
    renderChat(api, {}, false);
    await answerQuestions();
    await submitContact();
    expect(await screen.findByText("Want a specialist to call you to go over it? Pick a time of day.")).toBeTruthy();
    expect(api.bookingLink).not.toHaveBeenCalled();
  });

  test("explains a doubtful measurement instead of showing a price", async () => {
    const api = fakeApi({loadEstimate: vi.fn(async () => ({pending: false, state: {kind: "review" as const}, address: "x"}))});
    renderChat(api);
    await answerQuestions();
    await submitContact();
    expect(await screen.findByText(/a specialist will confirm it with you/)).toBeTruthy();
    expect(screen.queryByRole("region", {name: "Your estimate"})).toBeNull();
    expect(screen.getByText(/The quickest way to a firm number/)).toBeTruthy();
  });

  test("keeps the details and explains when the price can't be unlocked", async () => {
    const api = fakeApi({convert: vi.fn(async () => ({kind: "failed" as const}))});
    renderChat(api);
    await answerQuestions();
    await submitContact();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("(856) 835-6022");
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Jordan Rivera");
  });

  test("sends an expired preview back to the address step", async () => {
    renderChat(fakeApi({convert: vi.fn(async () => ({kind: "expired" as const}))}));
    await answerQuestions();
    await submitContact();
    expect((await screen.findByRole("link", {name: "Start again"})).getAttribute("href")).toBe("/roof-estimate");
  });

  test("picks up at the price when the homeowner comes back in the same tab", async () => {
    window.sessionStorage.setItem(`quote-chat:${token}`, JSON.stringify({estimateToken}));
    const api = fakeApi();
    renderChat(api, {status: "converted"});
    expect(await priceCard()).toContain("$14,000 to $21,000");
    expect(api.beacon).not.toHaveBeenCalled();
  });

  test("points a returning homeowner without the session to their text and email", async () => {
    renderChat(fakeApi(), {status: "converted"});
    expect(await screen.findByText("Your price is on its way by text and email. Open it there to see your options.")).toBeTruthy();
  });
});
