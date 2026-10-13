import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const tables = vi.hoisted(() => new Map<string, unknown[]>());
const counts = vi.hoisted(() => new Map<string, number>());
const leadFilters = vi.hoisted(() => [] as Array<[string, unknown]>);

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    rpc: vi.fn(async (name: string) => {
      if (name === "get_my_access") {
        return { data: [{ user_id: "u", company_id: "c", role: "company_admin", display_name: "Chris Boland", is_platform_admin: true }], error: null };
      }
      return {
        data: {
          since: "2026-04-16T00:00:00.000Z",
          stages: [
            { stage: "new", jobs: 490, value: 7388249.34 },
            { stage: "proposal_sent", jobs: 416, value: 7488920.81 },
            { stage: "won", jobs: 95, value: 1354800.33 },
          ],
          jobs: [],
          linked_leads: [],
        },
        error: null,
      };
    }),
    from(table: string) {
      let head = false;
      const builder = {
        select: (_columns: string, options?: { head?: boolean }) => {
          head = Boolean(options?.head);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          if (table === "leads") leadFilters.push([column, value]);
          return builder;
        },
        is: () => builder,
        in: () => builder,
        gte: () => builder,
        lt: () => builder,
        neq: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            head ? { count: counts.get(table) ?? 0, data: null, error: null } : { data: tables.get(table) ?? [], error: null },
          ).then(resolve),
      };
      return builder;
    },
  })),
}));

const { default: MyDayPage } = await import("./page");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:30:00.000Z"));
  tables.clear();
  counts.clear();
  leadFilters.length = 0;
  tables.set("leads", [
    {
      id: "lead-1",
      name: "Maria Alvarez",
      phone: "+16095550101",
      submitted_address: "14 Linden Ave",
      source_system: "piw_intake",
      created_at: "2026-10-13T12:10:00.000Z",
    },
  ]);
  tables.set("roof_estimates", [{ lead_id: "lead-1", status: "ready", range_low_cents: 1_420_000, range_high_cents: 2_130_000 }]);
  tables.set("tasks", [
    { id: "t1", title: "Send proposal", due_at: "2026-10-12T15:00:00.000Z", lead_id: "lead-1", leads: { name: "Greg Walsh", stage: "estimating", is_test: false } },
  ]);
  tables.set("customer_journey_events", [{ source_ref: "jn-9", occurred_at: "2026-10-05T15:00:00.000Z" }]);
  tables.set("jn_jobs", [
    {
      jnid: "jn-9",
      number: "3681",
      primary_contact_jnid: "c-9",
      sales_rep_name: "Pete Thomas",
      approved_total: 20000,
      estimate_total: 0,
      city: "Paramus",
      projected_at: "2026-10-13T12:17:00.000Z",
      address_line1: null,
      jn_created_at: "2026-10-01T00:00:00.000Z",
    },
  ]);
  tables.set("jn_contacts", [{ jnid: "c-9", display_name: "Yleana Contreras" }]);
  tables.set("sms_messages", [
    { id: "s1", body: "Can you come Tuesday after 4?", created_at: "2026-10-13T12:00:00.000Z", from_e164: "+16095550101", lead_id: "lead-1", leads: { name: "Ana Rivera" } },
  ]);
  counts.set("leads", 3);
  counts.set("jn_jobs", 29);
  counts.set("review_tasks", 2);
  return () => vi.useRealTimers();
});

test("My day shows who to call, what is due and what sold", async () => {
  render(await MyDayPage());

  expect(screen.getByRole("heading", { name: "Good morning, Chris" })).toBeInTheDocument();
  expect(screen.getByText("Tuesday, October 13")).toBeInTheDocument();
  expect(screen.getByText("JobNimbus synced 13m ago")).toBeInTheDocument();

  expect(screen.getByText("1 signed job").parentElement).toHaveTextContent("$20.0k");
  // Open pipeline is New + Proposal sent; Won is closed.
  expect(screen.getByText("906 active jobs · 6 months").parentElement).toHaveTextContent("$14.88M");
  expect(screen.getByText("Last 7 days, Rake + JobNimbus").parentElement).toHaveTextContent("32");
  expect(screen.getByText("1 overdue")).toBeInTheDocument();

  const respond = screen.getByRole("region", { name: /Respond now/ });
  expect(within(respond).getByRole("link", { name: "Maria Alvarez" })).toHaveAttribute("href", "/leads/lead-1");
  expect(within(respond).getByText("$14.2k–$21.3k")).toBeInTheDocument();
  expect(within(respond).getByText("20m")).toBeInTheDocument();
  expect(within(respond).getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:+16095550101");

  const tasks = screen.getByRole("region", { name: "Tasks" });
  expect(within(tasks).getByText("Send proposal")).toBeInTheDocument();
  expect(within(tasks).getByText("Yesterday")).toBeInTheDocument();

  const sold = screen.getByRole("region", { name: "Recently sold" });
  expect(within(sold).getByRole("link", { name: "Yleana Contreras" })).toHaveAttribute("href", "/jobs/jn-9");
  expect(screen.getByRole("link", { name: "2 awaiting review" })).toHaveAttribute("href", "/review");
  expect(screen.getByText("No appointments booked for today.")).toBeInTheDocument();
  const replies = screen.getByRole("region", { name: "Replies" });
  expect(within(replies).getByRole("link", { name: "Ana Rivera" })).toHaveAttribute("href", "/leads/lead-1#conversation");
  expect(within(replies).getByText("Can you come Tuesday after 4?")).toBeInTheDocument();

  // Test and verification leads stay off the home screen.
  expect(leadFilters).toContainEqual(["is_test", false]);
});
