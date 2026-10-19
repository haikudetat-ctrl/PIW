import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const tables = vi.hoisted(() => new Map<string, unknown>());

function builder(table: string) {
  const result = () => Promise.resolve({ data: tables.get(table) ?? null, error: null });
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "order", "limit"]) chain[method] = () => chain;
  chain.maybeSingle = result;
  chain.then = (resolve: (value: unknown) => unknown) => result().then(resolve);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    rpc: async () => ({
      data: [{ user_id: "u1", company_id: "c1", display_name: "Chris", role: "company_admin", is_platform_admin: false }],
      error: null,
    }),
    from: (table: string) => builder(table),
  })),
}));
vi.mock("./actions", () => ({
  assignRepFromForm: vi.fn(),
  cancelVirtualConsultation: vi.fn(),
  recordConsultationOutcome: vi.fn(),
  retryCalendarSync: vi.fn(),
}));

const { default: AppointmentsPage } = await import("./page");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  tables.clear();
});

function row(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    lead_id: crypto.randomUUID(),
    rep_id: null,
    status: "scheduled",
    scheduled_at: "2026-10-20T14:00:00.000Z",
    duration_minutes: 30,
    meeting_url: null,
    calendar_sync_status: "pending",
    calendar_sync_error: null,
    customer_notes: null,
    booking_source: "self_service",
    leads: { name: "Jordan Rivera", phone: "+16095550101" },
    ...overrides,
  };
}

test("splits consultations into needs a rep, upcoming, and needs an outcome", async () => {
  tables.set("booking_settings", { is_enabled: true, timezone: "America/New_York" });
  tables.set("reps", [{ id: "r1", name: "Alex Morgan", email: "alex@example.com" }]);
  tables.set("appointments", [
    row({ customer_notes: "Hail damage" }),
    row({ rep_id: "r1", leads: { name: "Sam Lee", phone: "1" }, calendar_sync_status: "synced", meeting_url: "https://meet.google.com/abc" }),
    row({ scheduled_at: "2026-10-18T14:00:00.000Z", leads: { name: "Pat Kim", phone: "1" }, calendar_sync_status: "failed" }),
  ]);

  render(await AppointmentsPage());

  expect(screen.getByText("2 upcoming · 1 need a rep · 1 need an outcome")).toBeInTheDocument();
  const needsRep = screen.getByRole("region", { name: "Needs a rep" });
  expect(within(needsRep).getByRole("link", { name: "Jordan Rivera" })).toBeInTheDocument();
  expect(within(needsRep).getByText("Tue, Oct 20, 10:00 AM")).toBeInTheDocument();
  expect(within(needsRep).getByRole("button", { name: "Assign" })).toBeInTheDocument();

  const upcoming = screen.getByRole("region", { name: "Upcoming" });
  expect(within(upcoming).getByRole("link", { name: "Open Meet" })).toHaveAttribute("href", "https://meet.google.com/abc");

  const past = screen.getByRole("region", { name: "Needs an outcome" });
  expect(within(past).getByRole("button", { name: "No-show" })).toBeInTheDocument();
  expect(within(past).getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("explains when booking is switched off", async () => {
  tables.set("appointments", []);
  render(await AppointmentsPage());
  expect(screen.getByText(/Online booking is off/)).toBeInTheDocument();
  expect(screen.getByText("Every upcoming consultation has a rep.")).toBeInTheDocument();
});
