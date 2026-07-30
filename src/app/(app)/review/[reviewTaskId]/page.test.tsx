import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

type QueryLog = {
  table: string;
  select: string;
};

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
  } as Record<string, unknown>,
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

const database = vi.hoisted(() => ({
  results: new Map<string, { data: unknown; error: null | { message: string } }>(),
  queries: [] as QueryLog[],
}));

function result(data: unknown) {
  return { data, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from(table: string) {
      const query: QueryLog = { table, select: "" };
      database.queries.push(query);
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          if (table === "review_tasks") {
            return Promise.resolve({ data: task, error: null });
          }
          return Promise.resolve(
            database.results.get(table) ?? { data: null, error: null },
          );
        },
        then(
          resolve: (value: {
            data: unknown;
            error: null | { message: string };
          }) => unknown,
        ) {
          return Promise.resolve(
            database.results.get(table) ?? { data: [], error: null },
          ).then(resolve);
        },
      };
      return builder;
    },
  })),
}));

vi.mock("./parcel-map", () => ({
  ParcelMap: ({
    candidates,
  }: {
    candidates: {
      geometry: { type?: string } | null;
      label: string;
      latitude?: number | null;
      longitude?: number | null;
    }[];
  }) => (
    <div aria-label="Parcel candidate map">
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.label}>
            {candidate.label} · {candidate.geometry?.type ?? "Point"} ·{" "}
            {candidate.latitude ?? "no latitude"} ·{" "}
            {candidate.longitude ?? "no longitude"}
          </li>
        ))}
      </ul>
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

beforeEach(() => {
  database.results.clear();
  database.queries.length = 0;
  task.reason = "multiple_parcels";
  task.candidate_data = {
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
  };
  database.results.set("properties", result([]));
  database.results.set("property_addresses", result([]));
  database.results.set("parcels", result([]));
  database.results.set(
    "provider_requests",
    result([
      {
        id: "50000000-0000-4000-8000-000000000001",
        provider: "njgin_parcels_composite",
        requested_at: "2026-07-29T18:00:00.000Z",
        completed_at: "2026-07-29T18:00:05.000Z",
      },
    ]),
  );
});

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
  expect(
    screen.getByRole("heading", { name: "Provider evidence" }),
  ).toBeInTheDocument();
  expect(screen.getByText("NJGIN parcels composite")).toBeInTheDocument();
  expect(
    screen.getByText("Jul 29, 2026", { exact: false }),
  ).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Block 10/i })).toBeInTheDocument();
  expect(
    screen.getByText(
      "Resolves this property and completes the pipeline; a selected parcel is saved as primary.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Reopens this property and pipeline, then queues a new property-discovery attempt.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Marks the property unsupported and completes the pipeline with partial results.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Closes this task and marks the pipeline failed without selecting a candidate.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resolve task" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reject task" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry worker" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mark unsupported" }),
  ).toBeInTheDocument();
});

test("loads duplicate candidates with their address points and parcel geometry", async () => {
  const firstCandidateId = "60000000-0000-4000-8000-000000000001";
  const secondCandidateId = "60000000-0000-4000-8000-000000000002";
  task.reason = "duplicate_candidates";
  task.candidate_data = {
    candidatePropertyIds: [firstCandidateId, secondCandidateId],
  };
  database.results.set(
    "properties",
    result([
      {
        id: firstCandidateId,
        canonical_address: "100 Oak Avenue, Trenton, NJ",
        municipality: "Trenton",
        county: "Mercer",
      },
      {
        id: secondCandidateId,
        canonical_address: "102 Oak Avenue, Trenton, NJ",
        municipality: "Trenton",
        county: "Mercer",
      },
    ]),
  );
  database.results.set(
    "property_addresses",
    result([
      {
        property_id: firstCandidateId,
        canonical_address: "100 Oak Avenue, Trenton, NJ",
        latitude: 40.31,
        longitude: -74.71,
        provider_request_id: "50000000-0000-4000-8000-000000000002",
        created_at: "2026-07-20T15:00:00.000Z",
      },
      {
        property_id: secondCandidateId,
        canonical_address: "102 Oak Avenue, Trenton, NJ",
        latitude: 40.32,
        longitude: -74.72,
        provider_request_id: null,
        created_at: "2026-07-21T15:00:00.000Z",
      },
    ]),
  );
  database.results.set(
    "parcels",
    result([
      {
        property_id: firstCandidateId,
        block: "40",
        lot: "9",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-74.711, 40.309],
              [-74.709, 40.309],
              [-74.709, 40.311],
              [-74.711, 40.309],
            ],
          ],
        },
        provider_request_id: "50000000-0000-4000-8000-000000000003",
        created_at: "2026-07-20T15:05:00.000Z",
      },
    ]),
  );

  render(
    await ReviewTaskPage({
      params: Promise.resolve({ reviewTaskId: task.id }),
    }),
  );

  const map = screen.getByLabelText("Parcel candidate map");
  expect(map).toHaveTextContent(
    "Candidate 1 · 100 Oak Avenue, Trenton, NJ · Block 40 · Lot 9",
  );
  expect(map).toHaveTextContent("Polygon");
  expect(map).toHaveTextContent("40.31");
  expect(map).toHaveTextContent(
    "Candidate 2 · 102 Oak Avenue, Trenton, NJ",
  );
  expect(map).toHaveTextContent("40.32");
  expect(
    screen.getByText(
      "Completes the pipeline; a selected candidate re-links this lead to that existing property.",
    ),
  ).toBeInTheDocument();

  for (const table of ["properties", "property_addresses", "parcels"]) {
    const query = database.queries.find((candidate) => candidate.table === table);
    expect(query?.select).not.toMatch(/owner|private/i);
  }
});
