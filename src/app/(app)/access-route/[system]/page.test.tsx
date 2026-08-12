import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table !== "leadconduit_events") throw new Error(`Unexpected table ${table}`);
      return {
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({
              data: [{
                event_id: "shadow-event-1",
                flow_id: "6377949a81800d03d54119b5",
                source_name: "Synthetic Source",
                event_type: "shadow_checkpoint",
                raw_status: "likely_filter_match",
                reason_category: "apartment_classification",
                occurred_at: "2026-08-12T16:00:00.000Z",
                submitted_email: "must-not-render@example.invalid",
              }],
            })),
          })),
        })),
      };
    }),
  })),
}));

const { default: AccessRouteSystemPage } = await import("./page");

test("shows sanitized LeadConduit candidate status and reason without customer values", async () => {
  render(await AccessRouteSystemPage({ params: Promise.resolve({ system: "leadconduit" }) }));

  expect(screen.getByText("Likely Filter Match")).toBeInTheDocument();
  expect(screen.getByText("Apartment Classification")).toBeInTheDocument();
  expect(screen.queryByText("must-not-render@example.invalid")).not.toBeInTheDocument();
});
