import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const tables = vi.hoisted(() => new Map<string, unknown>());
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const result = () => {
        const value = tables.get(table);
        if (typeof value === "function") return value(filters);
        return value;
      };
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          const rows = result() as unknown[] | undefined;
          return { data: rows?.[0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => {
          const rows = (result() as unknown[] | undefined) ?? [];
          return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
        },
      };
      return builder;
    },
  })),
}));

const { default: JobPage } = await import("./page");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));
  tables.clear();
  tables.set("jn_jobs", [
    {
      jnid: "jn-1",
      number: "3670",
      status_name: "Quoted",
      status_changed_at: "2026-10-12T22:09:26Z",
      primary_contact_jnid: "c-1",
      sales_rep_name: "Micah Wilson",
      address_line1: "345 North Mannheim Avenue",
      city: "Egg Harbor City",
      state_text: "NJ",
      zip: "08215",
      shingle_line: "Landmark",
      job_type: null,
      estimate_total: "18250.00",
      approved_total: "0.00",
      jn_created_at: "2026-10-01T14:00:00Z",
      projected_at: "2026-10-13T11:17:00Z",
    },
  ]);
  tables.set("jn_contacts", [
    { display_name: "Mike Martella", email_normalized: "mike@example.com", phone_normalized: "+16095550142", source_name: "RC" },
  ]);
  tables.set("jobnimbus_status_stages", [{ company_id: null, stage: "quoted" }]);
  tables.set("jn_estimates", [
    { jnid: "e-1", number: "88", status_name: "Sent", estimate_total: "18250.00", approved_total: null, jn_created_at: "2026-10-10T14:00:00Z" },
  ]);
  tables.set("jn_files", [{ jnid: "f-1", filename: "Roofr report.pdf", jn_created_at: "2026-10-09T14:00:00Z" }]);
  tables.set("jobnimbus_roofr_reports", [
    { total_squares: "24.10", predominant_pitch_12: "6.00", facets: 14, two_story_squares: null, flat_squares: "0.00", processed_at: "2026-10-09T15:00:00Z" },
  ]);
  tables.set("customer_identities", (filters: Record<string, unknown>) =>
    filters.source_system === "piw_lead" ? [{ external_id: "lead-9" }] : [{ customer_id: "cust-1" }],
  );
  tables.set("customer_journey_events", [
    { stage: "quoted", occurred_at: "2026-10-12T22:09:26Z", source_system: "jobnimbus_job", source_ref: "jn-1" },
    { stage: "handoff", occurred_at: "2026-10-01T14:00:00Z", source_system: "jobnimbus_job", source_ref: "jn-1" },
  ]);
  return () => vi.useRealTimers();
});

test("shows a JobNimbus job inside Rake with its customer, progress and JobNimbus data", async () => {
  render(await JobPage({ params: Promise.resolve({ jnid: "jn-1" }) }));

  expect(screen.getByRole("heading", { name: "Job #3670" })).toBeInTheDocument();
  expect(screen.getByText("Mike Martella · 345 North Mannheim Avenue, Egg Harbor City · Landmark · $18,250")).toBeInTheDocument();
  expect(screen.getByText(/Synced from JobNimbus · 43m ago/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open in JobNimbus" })).toHaveAttribute("href", "https://app.jobnimbus.com/job/jn-1");
  expect(screen.getByRole("link", { name: "Open Rake lead" })).toHaveAttribute("href", "/leads/lead-9");

  const progress = screen.getByRole("region", { name: "Progress" });
  expect(within(progress).getByText("(current)", { exact: false }).parentElement).toHaveTextContent("Quoted");

  const job = screen.getByRole("region", { name: "Job" });
  expect(within(job).getByText("Proposal Sent")).toBeInTheDocument();
  expect(within(job).getByText("Micah Wilson")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Roof measurement" })).getByText("24.1 sq")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Estimates" })).getByText("Sent")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Files" })).getByText("Roofr report.pdf")).toBeInTheDocument();

  const customer = screen.getByRole("region", { name: "Customer" });
  expect(within(customer).getByRole("link", { name: "(609) 555-0142" })).toHaveAttribute("href", "tel:+16095550142");
  expect(within(screen.getByRole("region", { name: "Activity" })).getByText("Created in JobNimbus")).toBeInTheDocument();
});

test("a job the member cannot see is not found", async () => {
  tables.set("jn_jobs", []);
  await expect(JobPage({ params: Promise.resolve({ jnid: "missing" }) })).rejects.toThrow("NEXT_NOT_FOUND");
});
