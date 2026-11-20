import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const queue = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    rpc: async (name: string) => {
      if (name !== "list_job_closeout_queue") throw new Error(`unexpected rpc ${name}`);
      return { data: queue.rows, error: null };
    },
  })),
}));

const { default: CloseoutsPage } = await import("./page");

function row(overrides: Record<string, unknown>) {
  return {
    job_jnid: crypto.randomUUID(),
    job_number: "4512",
    status_name: "Signed Contract",
    status_stage: "sold",
    customer_name: "Dana Whitfield",
    city: "Linwood",
    sales_rep_name: "Pete Thomas",
    job_type: "Roof & RR",
    delivered_at: "2026-11-17T17:21:47Z",
    photo_count: 48,
    closeout_id: null,
    closeout_status: null,
    homeowner_signed: false,
    submitted_at: null,
    writeback_state: null,
    ...overrides,
  };
}

test("splits jobs into ready, in progress and submitted, and flags jobs JobNimbus never moved", async () => {
  queue.rows = [
    row({ customer_name: "Dana Whitfield" }),
    row({ customer_name: "Ray Ortiz", status_name: "Quoted", status_stage: "quoted" }),
    row({ customer_name: "Lena Park", closeout_id: crypto.randomUUID(), closeout_status: "draft", homeowner_signed: true }),
    row({
      customer_name: "Sam Cole",
      closeout_id: crypto.randomUUID(),
      closeout_status: "submitted",
      submitted_at: "2026-11-19T15:00:00Z",
      writeback_state: "failed",
    }),
  ];

  render(await CloseoutsPage());

  const ready = screen.getByRole("region", { name: "Ready to close out" });
  expect(within(ready).getByText("Dana Whitfield")).toBeInTheDocument();
  expect(within(ready).getByText("JobNimbus says Quoted")).toBeInTheDocument();
  expect(within(ready).getAllByText("48 photos since delivery")).toHaveLength(2);

  const inProgress = screen.getByRole("region", { name: "In progress" });
  expect(within(inProgress).getByText("Lena Park")).toBeInTheDocument();
  expect(within(inProgress).getByText("Homeowner signed")).toBeInTheDocument();

  const submitted = screen.getByRole("region", { name: "Submitted" });
  expect(within(submitted).getByText("Filing failed")).toBeInTheDocument();
  expect(within(submitted).getByRole("link", { name: /Sam Cole/ })).toHaveAttribute(
    "href",
    expect.stringMatching(/^\/closeouts\//),
  );
});

test("explains an empty queue", async () => {
  queue.rows = [];
  render(await CloseoutsPage());
  expect(screen.getByText(/New jobs show up here when their delivery receipt reaches JobNimbus/)).toBeInTheDocument();
});
