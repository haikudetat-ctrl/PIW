import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

type QueryResult = { data?: unknown[] | null; count?: number | null; error?: null };

const results = vi.hoisted(() => ({
  intakeQuality: { data: [] as unknown[] } as QueryResult,
  rawEvents: { data: [] as unknown[] } as QueryResult,
  downstream: { count: 0 } as QueryResult,
}));

// A thenable stand-in for the Supabase query builder: every filter returns
// the builder, awaiting it yields the canned result for that query.
function query(result: QueryResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: QueryResult) => unknown) => resolve({ error: null, ...result }),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "leadconduit_intake_quality") return query(results.intakeQuality);
      if (table === "leadconduit_events") {
        return {
          select: (_columns: string, options?: { head?: boolean }) =>
            options?.head ? query(results.downstream) : query(results.rawEvents),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  })),
}));

const { default: AccessRouteSystemPage } = await import("./page");

function intakeLead(overrides: Record<string, unknown> = {}) {
  return {
    flow_id: "6377949a81800d03d54119b5",
    lead_id: "lead-1",
    source_name: "Vendor A",
    received_at: new Date().toISOString(),
    lead_name: "Pat Homeowner",
    city: "Cherry Hill",
    state: "NJ",
    has_address: true,
    has_trustedform: true,
    has_phone: true,
    has_email: true,
    contact_redacted: false,
    repeat_of_received_at: null,
    repeat_of_source_name: null,
    jobnimbus_contact_since: null,
    service_states: ["NJ"],
    ...overrides,
  };
}

beforeEach(() => {
  results.intakeQuality = { data: [] };
  results.rawEvents = { data: [] };
  results.downstream = { count: 0 };
});

test("shows sanitized LeadConduit candidate status and reason without customer values", async () => {
  results.rawEvents = {
    data: [{
      event_id: "shadow-event-1",
      flow_id: "6377949a81800d03d54119b5",
      source_name: "Synthetic Source",
      event_type: "shadow_checkpoint",
      raw_status: "likely_filter_match",
      reason_category: "apartment_classification",
      occurred_at: "2026-08-12T16:00:00.000Z",
      submitted_email: "must-not-render@example.invalid",
    }],
  };

  render(await AccessRouteSystemPage({ params: Promise.resolve({ system: "leadconduit" }) }));

  expect(screen.getByText("Likely Filter Match")).toBeInTheDocument();
  expect(screen.getByText("Apartment Classification")).toBeInTheDocument();
  expect(screen.queryByText("must-not-render@example.invalid")).not.toBeInTheDocument();
});

test("scores each vendor and lists leads by name and town with their flags", async () => {
  results.intakeQuality = {
    data: [
      intakeLead({ lead_id: "l1", source_name: "Webrunner Media Group", lead_name: null, city: null, state: null,
        has_address: false, has_trustedform: false, has_email: false }),
      intakeLead({ lead_id: "l2", source_name: "NestBuilder", city: "Boston", state: "MA", has_trustedform: false }),
      intakeLead({ lead_id: "l3", source_name: "NestBuilder", repeat_of_received_at: new Date().toISOString(),
        repeat_of_source_name: "adopt a contractor" }),
    ],
  };
  results.downstream = { count: 0 };

  render(await AccessRouteSystemPage({ params: Promise.resolve({ system: "leadconduit" }) }));

  const scorecard = screen.getByRole("region", { name: "LeadConduit vendor scorecard" });
  const nestBuilder = within(scorecard).getByRole("row", { name: /^NestBuilder/ });
  expect(within(nestBuilder).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "2", "2", "2", "150%", "0", "150%", "0", "150%", "0",
  ]);
  expect(within(scorecard).getByRole("row", { name: /^All sources/ })).toBeInTheDocument();

  const feed = screen.getByRole("region", { name: "Latest LeadConduit leads" });
  expect(within(feed).getByText("Boston, MA")).toBeInTheDocument();
  expect(within(feed).getByText("Out of area (MA)")).toBeInTheDocument();
  expect(within(feed).getByText("Repeat (also adopt a contractor)")).toBeInTheDocument();
  expect(within(feed).getAllByText("No address").length).toBeGreaterThan(0);
  expect(within(feed).getByText("Missing name, email")).toBeInTheDocument();

  expect(screen.getByRole("note")).toHaveTextContent("Only the intake checkpoint is reporting");
});

test("drops the checkpoint notice once delivered or CoreLogic checkpoints arrive", async () => {
  results.intakeQuality = { data: [intakeLead()] };
  results.downstream = { count: 4 };

  render(await AccessRouteSystemPage({ params: Promise.resolve({ system: "leadconduit" }) }));

  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(screen.getByText("Clean")).toBeInTheDocument();
});
