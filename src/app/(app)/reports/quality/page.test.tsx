import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const tables = vi.hoisted(() => new Map<string, unknown[]>());

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: tables.get(table) ?? [], error: null }).then(resolve),
      };
      return builder;
    },
  })),
}));

const { default: DataQualityReportPage } = await import("./page");

beforeEach(() => {
  tables.clear();
});

test("compares the latest JobNimbus census with the previous one and lists unmapped statuses", async () => {
  tables.set("jobnimbus_census", [
    {
      captured_at: "2026-10-14T12:20:00Z",
      jobs: 2000,
      contacts: 1000,
      job_field_counts: { address_line1: 1900, shingle_line: 1500 },
      contact_field_counts: { phone_normalized: 950 },
      unmapped_statuses: [{ status: "Lead", jobs: 900 }, { status: "Solar", jobs: 12 }],
    },
    {
      captured_at: "2026-10-14T11:20:00Z",
      jobs: 2000,
      contacts: 1000,
      job_field_counts: { address_line1: 1900, shingle_line: 1600 },
      contact_field_counts: { phone_normalized: 950 },
      unmapped_statuses: [],
    },
  ]);
  tables.set("jobnimbus_sync_runs", [
    { id: "r1", record_type: "job", mode: "incremental", status: "ok", records_seen: 40, records_changed: 3, started_at: "2026-10-14T12:17:00Z", error: null },
  ]);

  render(await DataQualityReportPage({ searchParams: Promise.resolve({}) }));

  const jobFields = screen.getByRole("region", { name: "Job fields" });
  expect(within(jobFields).getByText("95.0%")).toBeInTheDocument();
  expect(within(jobFields).getByText("75.0%")).toBeInTheDocument();
  expect(within(jobFields).getByText("−5.0 pts")).toHaveClass("text-danger");

  const unmapped = screen.getByRole("region", { name: "Unmapped statuses" });
  expect(within(unmapped).getByText("Lead")).toBeInTheDocument();
  expect(within(unmapped).getByText("900 jobs")).toBeInTheDocument();

  expect(screen.getByRole("region", { name: "Recent JobNimbus syncs" })).toHaveTextContent("Ok");
  // Data quality is current state, so there is no date range control.
  expect(screen.queryByRole("navigation", { name: "Date range" })).not.toBeInTheDocument();
});

test("waits for the first census", async () => {
  render(await DataQualityReportPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("The first census is taken after the next JobNimbus sync.")).toBeInTheDocument();
});
