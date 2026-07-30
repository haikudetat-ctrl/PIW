import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const task = vi.hoisted(() => ({
  id: "10000000-0000-4000-8000-000000000001",
  reason: "multiple_parcels",
  status: "open",
  candidate_data: {
    candidates: [
      {
        block: "10",
        lot: "20",
        municipalityName: "Trenton",
        county: "Mercer",
        propertyClass: "2",
        landValue: 50000,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-74.77, 40.22],
              [-74.769, 40.22],
              [-74.769, 40.221],
              [-74.77, 40.22],
            ],
          ],
        },
        ownerName: "Must Never Render",
      },
    ],
  },
  retry_count: 0,
  resolution_notes: null,
  created_at: "2026-07-29T18:00:00.000Z",
  lead_id: "20000000-0000-4000-8000-000000000001",
  property_id: "30000000-0000-4000-8000-000000000001",
  pipeline_run_id: "40000000-0000-4000-8000-000000000001",
  triggering_event_name: "property/discovery_requested",
  leads: {
    name: "Jordan Rivera",
    submitted_address: "12 Birch Street, Trenton, NJ",
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: task, error: null })),
        })),
      })),
    })),
  })),
}));

vi.mock("./parcel-map", () => ({
  ParcelMap: ({ candidates }: { candidates: { label: string }[] }) => (
    <div aria-label="Parcel candidate map">
      {candidates.map((candidate) => candidate.label).join(", ")}
    </div>
  ),
}));

vi.mock("./review-actions", () => ({
  resolveReviewTask: vi.fn(),
  rejectReviewTask: vi.fn(),
  retryReviewTask: vi.fn(),
  markReviewTaskUnsupported: vi.fn(),
}));

const { default: ReviewTaskPage } = await import("./page");

test("shows safe parcel evidence and all four review actions", async () => {
  render(
    await ReviewTaskPage({
      params: Promise.resolve({ reviewTaskId: task.id }),
    }),
  );

  expect(
    screen.getByRole("heading", { name: "Review property match" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Block 10 · Lot 20" }),
  ).toBeInTheDocument();
  expect(screen.getByText("$50,000.00")).toBeInTheDocument();
  expect(screen.queryByText("Must Never Render")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "Parcel geometry is analytical and is not a legal survey.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Block 10/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resolve task" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reject task" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry worker" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mark unsupported" }),
  ).toBeInTheDocument();
});
