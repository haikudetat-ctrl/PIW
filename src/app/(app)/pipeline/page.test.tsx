import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const tables = vi.hoisted(() => new Map<string, unknown[]>());
const filters = vi.hoisted(() => new Map<string, Array<[string, unknown]>>());
const rpc = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, data: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    async rpc(name: string, args: unknown) {
      rpc.calls.push([name, args]);
      return { data: rpc.data, error: null };
    },
    from(table: string) {
      const tableFilters: Array<[string, unknown]> = [];
      filters.set(table, tableFilters);
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          tableFilters.push([column, value]);
          return builder;
        },
        order: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: tables.get(table) ?? [], error: null }).then(resolve),
      };
      return builder;
    },
  })),
}));

vi.mock("./actions", () => ({ moveLeadStage: vi.fn() }));

const { default: PipelinePage } = await import("./page");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T14:00:00.000Z"));
  tables.clear();
  rpc.calls = [];
  rpc.data = {
    since: "2026-04-13T14:00:00.000Z",
    stages: [
      { stage: "proposal_sent", jobs: 416, value: "149480.00" },
      { stage: "won", jobs: 95, value: 1354800.33 },
    ],
    jobs: [
      {
        jnid: "jn-1",
        number: "3670",
        name: "Mike Martella",
        address: "345 North Mannheim Avenue, Egg Harbor City",
        status_name: "Quoted",
        stage: "proposal_sent",
        sales_rep_name: "Micah Wilson",
        value: "18250.00",
        roofr_squares: "24.10",
        activity_at: "2026-10-09T14:00:00.000Z",
      },
      {
        jnid: "jn-2",
        number: "3681",
        name: null,
        address: null,
        status_name: "Signed Contract",
        stage: "won",
        sales_rep_name: null,
        value: 6814.8,
        roofr_squares: null,
        activity_at: "2026-10-08T14:00:00.000Z",
      },
    ],
    linked_leads: [{ lead_id: "a", jnid: "jn-9", status_name: "Lead" }],
  };
  tables.set("leads", [
    { id: "a", name: "Maria Alvarez", submitted_address: "14 Linden Ave", stage: "new", created_at: "2026-10-10T12:00:00.000Z" },
    { id: "b", name: "Greg Walsh", submitted_address: "220 Main St", stage: "estimating", created_at: "2026-10-01T14:00:00.000Z" },
    { id: "c", name: "Helen Brooks", submitted_address: "33 Maple Ave", stage: "won", created_at: "2026-09-01T14:00:00.000Z" },
  ]);
  tables.set("roof_estimates", [
    { lead_id: "a", status: "ready", range_low_cents: 1_420_000, range_high_cents: 2_130_000, roof_squares: 28.4 },
    { lead_id: "b", status: "pending", range_low_cents: null, range_high_cents: null, roof_squares: null },
  ]);
  tables.set("tasks", [
    { lead_id: "b", title: "Send proposal", due_at: "2026-10-09T14:00:00.000Z", status: "open" },
  ]);
  return () => vi.useRealTimers();
});

test("board shows open stage columns with estimate, next step and a collapsed closed column", async () => {
  render(await PipelinePage({ searchParams: Promise.resolve({}) }));

  const newColumn = screen.getByRole("region", { name: "New" });
  expect(within(newColumn).getByRole("link", { name: "Maria Alvarez" })).toHaveAttribute("href", "/leads/a");
  expect(within(newColumn).getByText("$14.2k–$21.3k")).toBeInTheDocument();
  expect(within(newColumn).getByText("28.4 sq")).toBeInTheDocument();

  const estimating = screen.getByRole("region", { name: "Estimating" });
  expect(within(estimating).getByText("Measuring roof…")).toBeInTheDocument();
  expect(within(estimating).getByText("Send proposal · overdue")).toBeInTheDocument();

  const closed = screen.getByRole("region", { name: "Closed" });
  expect(within(closed).getByRole("link", { name: /Won/ })).toHaveAttribute("href", "/pipeline?view=list&stage=won");
  expect(screen.queryByRole("link", { name: "Helen Brooks" })).not.toBeInTheDocument();

  // Open value adds the quoted JobNimbus totals to the lead estimates.
  expect(screen.getByText("$163.7k–$170.8k", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("Past their due time")).toBeInTheDocument();
  expect(filters.get("leads")).toContainEqual(["is_test", false]);
});

test("board shows JobNimbus jobs read-only next to the leads", async () => {
  render(await PipelinePage({ searchParams: Promise.resolve({}) }));

  expect(rpc.calls).toEqual([["pipeline_jobnimbus", { p_limit: 25 }]]);
  const proposal = screen.getByRole("region", { name: "Proposal Sent" });
  expect(within(proposal).getByRole("link", { name: "Mike Martella" })).toHaveAttribute(
    "href",
    "/jobs/jn-1",
  );
  expect(within(proposal).getByText("JobNimbus · Quoted")).toBeInTheDocument();
  expect(within(proposal).getByText("24.1 sq · Roofr")).toBeInTheDocument();
  expect(within(proposal).getByText("416")).toBeInTheDocument();
  expect(within(proposal).getByRole("link", { name: "+415 more JobNimbus jobs" })).toHaveAttribute(
    "href",
    "/pipeline?view=list&stage=proposal_sent",
  );
  // A lead whose customer is already in JobNimbus shows once, tagged.
  const newColumn = screen.getByRole("region", { name: "New" });
  expect(within(newColumn).getByText("JobNimbus · Lead")).toBeInTheDocument();

  const closed = screen.getByRole("region", { name: "Closed" });
  expect(within(within(closed).getByRole("link", { name: /Won/ })).getByText("96")).toBeInTheDocument();
  expect(screen.getByText("416 JobNimbus jobs", { exact: false })).toBeInTheDocument();
});

test("list view asks for one stage of JobNimbus jobs and counts the rest", async () => {
  render(await PipelinePage({ searchParams: Promise.resolve({ view: "list", stage: "won" }) }));

  expect(rpc.calls).toEqual([["pipeline_jobnimbus", { p_limit: 200, p_stage: "won" }]]);
  expect(screen.getByRole("link", { name: "Job #3681" })).toHaveAttribute("href", "/jobs/jn-2");
  expect(screen.getByText("+94 older JobNimbus jobs not shown")).toBeInTheDocument();
});

test("leads still render when JobNimbus jobs are unavailable", async () => {
  rpc.data = { unexpected: true };
  render(await PipelinePage({ searchParams: Promise.resolve({}) }));

  expect(screen.getByRole("link", { name: "Maria Alvarez" })).toBeInTheDocument();
  expect(screen.getByText(/JobNimbus jobs are unavailable right now/)).toBeInTheDocument();
});

test("list view filters by stage", async () => {
  render(await PipelinePage({ searchParams: Promise.resolve({ view: "list", stage: "won" }) }));

  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Helen Brooks" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Maria Alvarez" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Won", current: "page" })).toBeInTheDocument();
});
