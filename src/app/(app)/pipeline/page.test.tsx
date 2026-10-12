import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const tables = vi.hoisted(() => new Map<string, unknown[]>());

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
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

  expect(screen.getByText("$14.2k–$21.3k", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("Past their due time")).toBeInTheDocument();
});

test("list view filters by stage", async () => {
  render(await PipelinePage({ searchParams: Promise.resolve({ view: "list", stage: "won" }) }));

  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Helen Brooks" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Maria Alvarez" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Won", current: "page" })).toBeInTheDocument();
});
