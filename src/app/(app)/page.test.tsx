import { render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";

const leadQueries = vi.hoisted(() => [] as Array<{ columns: string; filters: Array<[string, unknown]> }>);

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    rpc: vi.fn(async () => ({
      data: {
        since: "2026-04-16T00:00:00.000Z",
        stages: [
          { stage: "new", jobs: 492, value: 84900 },
          { stage: "won", jobs: 95, value: 1354800.33 },
        ],
        jobs: [],
        linked_leads: [],
      },
      error: null,
    })),
    from: vi.fn((table: string) => {
      if (table === "leads") {
        const query = { columns: "", filters: [] as Array<[string, unknown]> };
        leadQueries.push(query);
        const builder = {
          select: (columns: string) => {
            query.columns = columns;
            return builder;
          },
          eq: (column: string, value: unknown) => {
            query.filters.push([column, value]);
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          then: (resolve: (value: { data: unknown[] }) => unknown) =>
            Promise.resolve({
              data:
                query.columns === "stage"
                  ? [{ stage: "new" }, { stage: "won" }]
                  : [
                      {
                        id: "lead-1",
                        name: "Jordan Rivera",
                        submitted_address: "12 Birch St",
                        created_at: "2026-07-29T00:00:00.000Z",
                      },
                    ],
            }).then(resolve),
        };
        return builder;
      }
      if (table === "pipeline_runs") {
        return {
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              lt: vi.fn(() => Promise.resolve({ data: [] })),
            })),
          })),
        };
      }
      if (table === "review_tasks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({ count: 2, data: null, error: null }),
            ),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  })),
}));

const { default: DashboardPage } = await import("./page");

test("shows new leads, pipeline totals, and a link to the pipeline board", async () => {
  render(await DashboardPage());
  expect(screen.getByRole("heading", { name: "Rake operations" })).toBeInTheDocument();
  expect(screen.getByText("Jordan Rivera")).toBeInTheDocument();
  expect(screen.getByText("View pipeline board")).toBeInTheDocument();
  // JobNimbus jobs count alongside Rake leads.
  expect(screen.getByText("589")).toBeInTheDocument();
  expect(screen.getByText("587 from JobNimbus")).toBeInTheDocument();
  expect(screen.getByText("493")).toBeInTheDocument();
  expect(screen.getByText("2 items awaiting review")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open review queue" })).toHaveAttribute(
    "href",
    "/review",
  );
  // Test and verification leads are left out of every count and list.
  expect(leadQueries).toHaveLength(2);
  for (const query of leadQueries) {
    expect(query.filters).toContainEqual(["is_test", false]);
  }
});
