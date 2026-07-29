import { render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "leads") {
        return {
          select: vi.fn((columns: string) => {
            if (columns === "stage") {
              return Promise.resolve({ data: [{ stage: "new" }, { stage: "won" }] });
            }
            return {
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() =>
                    Promise.resolve({
                      data: [
                        {
                          id: "lead-1",
                          name: "Jordan Rivera",
                          submitted_address: "12 Birch St",
                          created_at: "2026-07-29T00:00:00.000Z",
                        },
                      ],
                    }),
                  ),
                })),
              })),
            };
          }),
        };
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
      throw new Error(`Unexpected table ${table}`);
    }),
  })),
}));

const { default: DashboardPage } = await import("./page");

test("shows new leads, pipeline totals, and a link to the pipeline board", async () => {
  render(await DashboardPage());
  expect(screen.getByRole("heading", { name: "Property Intelligence Worker" })).toBeInTheDocument();
  expect(screen.getByText("Jordan Rivera")).toBeInTheDocument();
  expect(screen.getByText("View pipeline board")).toBeInTheDocument();
  expect(screen.getByText("0 items awaiting review")).toBeInTheDocument();
});
