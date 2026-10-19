import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import type {BookingPageModel} from "@/modules/booking/booking-service";
import {BookingExperience} from "./booking-experience";

type OpenModel = Extract<BookingPageModel, {kind: "open" | "booked"}>;

const model: OpenModel = {
  kind: "open",
  firstName: "Jordan",
  inviteEmail: "j•••@example.com",
  supportPhone: "(856) 835-6022",
  meetingTitle: "Virtual roof consultation",
  durationMinutes: 30,
  timezone: "America/New_York",
  booking: null,
  days: [
    {date: "2026-10-19", weekday: 1, slots: []},
    {
      date: "2026-10-20",
      weekday: 2,
      slots: [
        {startsAt: "2026-10-20T13:00:00.000Z", minuteOfDay: 540},
        {startsAt: "2026-10-20T14:00:00.000Z", minuteOfDay: 600},
      ],
    },
  ],
};

const booked = {
  appointmentId: "11111111-1111-4111-8111-111111111111",
  startsAt: "2026-10-20T14:00:00.000Z",
  endsAt: "2026-10-20T14:30:00.000Z",
  durationMinutes: 30,
  meetingUrl: null,
  calendarReady: false,
  inviteEmail: "j•••@example.com",
  canChange: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
}

afterEach(() => vi.unstubAllGlobals());

describe("BookingExperience", () => {
  test("opens on the first day with times and labels times in Eastern", () => {
    render(<BookingExperience token="abc.def" brandName="AllSeason Solar & Roofing" model={model} />);
    expect(screen.getByRole("radio", {name: /Monday, October 19, no times open/})).toBeDisabled();
    expect(screen.getByRole("radio", {name: /Tuesday, October 20/})).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", {name: "9:00 AM"})).toBeInTheDocument();
    expect(screen.getByText(/Times shown in EDT/)).toBeInTheDocument();
  });

  test("books the chosen time and shows the confirmation", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(booked));
    vi.stubGlobal("fetch", fetchMock);
    render(<BookingExperience token="abc.def" brandName="AllSeason Solar & Roofing" model={model} />);

    fireEvent.click(screen.getByRole("radio", {name: "10:00 AM"}));
    fireEvent.change(screen.getByLabelText(/Anything you'd like us to look at/), {target: {value: "Porch leak"}});
    fireEvent.click(screen.getByRole("button", {name: "Book my consultation"}));

    await screen.findByText("You're booked, Jordan");
    expect(screen.getByRole("heading", {name: "Tuesday, October 20 at 10:00 AM EDT"})).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/booking/abc.def", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({startsAt: "2026-10-20T14:00:00.000Z", attendeeEmail: "", notes: "Porch leak"}),
    }));
    expect(screen.getByRole("link", {name: "Add to my calendar"})).toHaveAttribute("href", "/api/booking/abc.def/calendar");
  });

  test("refreshes the times when the chosen one was just taken", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({error: "That time was just taken. Please pick another.", code: "slot_unavailable"}, 409))
      .mockResolvedValueOnce(jsonResponse({timezone: "America/New_York", days: [{...model.days[1], slots: [model.days[1].slots[0]]}]}));
    vi.stubGlobal("fetch", fetchMock);
    render(<BookingExperience token="abc.def" brandName="AllSeason Solar & Roofing" model={model} />);

    fireEvent.click(screen.getByRole("radio", {name: "10:00 AM"}));
    fireEvent.click(screen.getByRole("button", {name: "Book my consultation"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("That time was just taken");
    await waitFor(() => expect(screen.queryByRole("radio", {name: "10:00 AM"})).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/booking/abc.def", expect.objectContaining({cache: "no-store"}));
  });

  test("asks before cancelling and then offers a new time", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({cancelled: true}));
    vi.stubGlobal("fetch", fetchMock);
    render(<BookingExperience token="abc.def" brandName="AllSeason Solar & Roofing" model={{...model, kind: "booked", booking: booked}} />);

    fireEvent.click(screen.getByRole("button", {name: "Cancel consultation"}));
    fireEvent.click(screen.getByRole("button", {name: "Yes, cancel it"}));

    await screen.findByText("Your consultation is cancelled.");
    expect(fetchMock).toHaveBeenCalledWith("/api/booking/abc.def/cancel", expect.objectContaining({method: "POST"}));
    expect(screen.getByRole("button", {name: "Pick a new time"})).toBeInTheDocument();
  });
});
