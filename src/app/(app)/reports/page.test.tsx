import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({ rpc })),
}));

const { default: FunnelReportPage } = await import("./page");

const FUNNEL = {
  from: "2026-07-16T12:00:00Z",
  to: "2026-10-14T12:00:00Z",
  leads: 400,
  prior_leads: 320,
  steps: [
    { key: "lead", customers: 400 },
    { key: "appointment", customers: 360 },
    { key: "quoted", customers: 340 },
    { key: "sold", customers: 34 },
    { key: "completed", customers: 10 },
  ],
  lost: 6,
  sold_jobs: 30,
  revenue: 540000,
  median_days: { lead_to_quoted: 0.5, quoted_to_sold: 7.3, sold_to_completed: null },
  sources: [
    { source: "RC", leads: 250, quoted: 220, sold: 22, revenue: 360000 },
    { source: "Web Search", leads: 10, quoted: 8, sold: 1, revenue: 18000 },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  return () => vi.useRealTimers();
});

test("shows the unified funnel, KPIs and lead sources for the selected range", async () => {
  rpc.mockResolvedValue({ data: FUNNEL, error: null });

  render(await FunnelReportPage({ searchParams: Promise.resolve({ range: "90" }) }));

  expect(rpc).toHaveBeenCalledWith("report_funnel", {
    p_from: "2026-07-16T12:00:00.000Z",
    p_to: "2026-10-14T12:00:00.000Z",
  });
  expect(screen.getByRole("link", { name: "Funnel" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("+25% vs prior period")).toBeInTheDocument();
  expect(screen.getByText("34 of 340 quoted").previousSibling).toHaveTextContent("10%");
  expect(screen.getByText("Approved JobNimbus totals").previousSibling).toHaveTextContent("$18k"); // 540k / 30

  const funnel = screen.getByRole("region", { name: "Stage funnel" });
  expect(within(funnel).getByText("Sold")).toBeInTheDocument();
  expect(within(funnel).getByText("10% of previous")).toBeInTheDocument();

  const sources = screen.getByRole("region", { name: "Lead sources" });
  expect(within(sources).getByRole("rowheader", { name: "RC" })).toBeInTheDocument();
  expect(within(sources).getByText("$360k")).toBeInTheDocument();

  // Range links keep the current tab.
  expect(screen.getByRole("link", { name: "Last 12 months" })).toHaveAttribute("href", "/reports?range=365");
  expect(screen.getByRole("link", { name: "Revenue" })).toHaveAttribute("href", "/reports/revenue");
});

test("fails safely when the report cannot load", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function report_funnel" } });
  await expect(FunnelReportPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Failed to load funnel report");
});
