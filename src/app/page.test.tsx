import { render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "admin-1" } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { id: "admin-1" } })),
        })),
      })),
    })),
  })),
}));

const { default: HomePage } = await import("./page");

test("identifies the application and foundation status for an authenticated admin", async () => {
  render(await HomePage());
  expect(
    screen.getByRole("heading", { name: "Property Intelligence Worker" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Foundation online")).toBeInTheDocument();
});
