import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const queryResult = vi.hoisted(() => ({
  data: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      reason: "low_address_confidence",
      status: "open",
      created_at: "2026-07-29T18:00:00.000Z",
      property_id: "20000000-0000-4000-8000-000000000001",
      leads: {
        name: "Jordan Rivera",
        submitted_address: "12 Birch Street, Trenton, NJ",
      },
    },
  ],
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => queryResult),
        })),
      })),
    })),
  })),
}));

const { default: ReviewQueuePage } = await import("./page");

beforeEach(() => {
  queryResult.error = null;
});

test("lists open review tasks with lead and address context", async () => {
  render(await ReviewQueuePage());

  expect(
    screen.getByRole("heading", { name: "Review queue" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Open review tasks" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Jordan Rivera/i }),
  ).toHaveAttribute(
    "href",
    "/review/10000000-0000-4000-8000-000000000001",
  );
  expect(
    screen.getByText("12 Birch Street, Trenton, NJ"),
  ).toBeInTheDocument();
  expect(screen.getByText(/Low Address Confidence/i)).toBeInTheDocument();
});
