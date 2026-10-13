import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const LEAD_ID = "20000000-0000-4000-8000-000000000001";
const PROPERTY_ID = "30000000-0000-4000-8000-000000000001";

type QueryLog = {
  table: string;
  select: string;
  filters: Array<[string, unknown]>;
};

const database = vi.hoisted(() => ({
  results: new Map<
    string,
    { data: unknown; error: { message: string } | null }
  >(),
  queries: [] as QueryLog[],
}));

function result(data: unknown) {
  return { data, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from(table: string) {
      const query: QueryLog = { table, select: "", filters: [] };
      database.queries.push(query);
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(
            database.results.get(table) ?? { data: null, error: null },
          );
        },
        then(
          resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
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
  ParcelMap: ({ candidates }: { candidates: { label: string }[] }) => (
    <div aria-label="Parcel candidate map">
      {candidates.map((candidate) => candidate.label).join(", ")}
    </div>
  ),
}));

vi.mock("./conversation-data", () => ({
  loadConversation: vi.fn(async () => ({
    messages: [
      { id: "m1", direction: "outbound", body: "Hi Jordan, your estimate is ready.", status: "delivered", error_code: null, created_at: "2026-07-29T14:00:00.000Z" },
      { id: "m2", direction: "inbound", body: "Can someone come look?", status: "received", error_code: null, created_at: "2026-07-29T14:05:00.000Z" },
    ],
    to: "(609) 555-0101",
    consent: "SMS consent on file",
    blockedReason: null,
    fields: { first_name: "Jordan", rep_name: "Chris", company_name: "All Season" },
  })),
}));
vi.mock("./sms-actions", () => ({ sendSms: vi.fn() }));

const { default: LeadWorkspacePage } = await import("./page");

beforeEach(() => {
  database.queries.length = 0;
  database.results.clear();
  database.results.set(
    "leads",
    result({
      id: LEAD_ID,
      company_id: COMPANY_ID,
      name: "Jordan Rivera",
      phone: "609-555-0184",
      email: "jordan@example.com",
      submitted_address: "12 Birch Street, Trenton, NJ",
      notes: null,
      stage: "qualified",
      property_id: PROPERTY_ID,
      properties: {
        canonical_address: "12 Birch St, Trenton, NJ 08608",
        resolution_status: "resolved",
      },
    }),
  );
  database.results.set("lead_stage_history", result([]));
  database.results.set("interactions", result([]));
  database.results.set("tasks", result([]));
  database.results.set(
    "property_addresses",
    result({
      canonical_address: "12 Birch St, Trenton, NJ 08608",
      submitted_address: "12 Birch Street, Trenton, NJ",
      match_method: "exact_single_match",
      confidence: 98,
      municipality: "Trenton",
      county: "Mercer",
      state_code: "NJ",
      zip: "08608",
      latitude: 40.2206,
      longitude: -74.7699,
      created_at: "2026-07-29T18:10:00.000Z",
      ownerName: "Must Never Render",
    }),
  );
  database.results.set(
    "parcels",
    result({
      id: "40000000-0000-4000-8000-000000000001",
      block: "10",
      lot: "20",
      qualifier: null,
      pams_pin: "1100_10_20",
      municipality_name: "Trenton",
      county: "Mercer",
      property_class: "2",
      acreage: 0.1845,
      year_built: 1987,
      land_value_cents: 5_000_000,
      improvement_value_cents: 15_000_025,
      net_value_cents: 20_000_025,
      street_address: "12 BIRCH ST",
      building_description: "1.5S-F-AG",
      dwelling_units: 1,
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
      created_at: "2026-07-29T18:15:00.000Z",
      ownerName: "Must Never Render",
    }),
  );
  database.results.set(
    "structures",
    result({
      source: "njgin_parcel_geometry",
      footprint_geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-74.7698, 40.2202],
            [-74.7694, 40.2202],
            [-74.7694, 40.2206],
            [-74.7698, 40.2202],
          ],
        ],
      },
      created_at: "2026-07-29T18:15:00.000Z",
      ownerName: "Must Never Render",
    }),
  );
});

test("renders tenant-scoped address, parcel, and structure evidence without private fields", async () => {
  render(
    await LeadWorkspacePage({
      params: Promise.resolve({ leadId: LEAD_ID }),
    }),
  );

  expect(
    screen.getByRole("heading", { name: "Property profile" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Resolved")).toBeInTheDocument();
  expect(screen.getByText("Exact single match")).toBeInTheDocument();
  expect(screen.getByText("98%")).toBeInTheDocument();
  expect(screen.getByText("Block 10 · Lot 20")).toBeInTheDocument();
  expect(screen.getByText("$50,000.00")).toBeInTheDocument();
  expect(screen.getByText("$150,000.25")).toBeInTheDocument();
  expect(screen.getByText("$200,000.25")).toBeInTheDocument();
  expect(screen.getByText("NJGIN parcel geometry")).toBeInTheDocument();
  expect(
    screen.getByLabelText("Parcel candidate map"),
  ).toHaveTextContent("Parcel boundary, Structure footprint");
  expect(
    screen.getByText(
      "Parcel geometry and public-record data are analytical aids and are not a legal survey, appraisal, or title report.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Must Never Render")).not.toBeInTheDocument();
  expect(
    screen.getAllByText(/Jul 29, 2026/i).length,
  ).toBeGreaterThanOrEqual(3);

  for (const table of ["property_addresses", "parcels", "structures"]) {
    const query = database.queries.find((candidate) => candidate.table === table);
    expect(query?.filters).toContainEqual(["company_id", COMPANY_ID]);
    expect(query?.filters).toContainEqual(["property_id", PROPERTY_ID]);
    expect(query?.select).not.toMatch(/owner|private/i);
  }
});

test("shows useful empty states while property evidence is pending", async () => {
  database.results.set("property_addresses", result(null));
  database.results.set("parcels", result(null));
  database.results.set("structures", result(null));

  render(
    await LeadWorkspacePage({
      params: Promise.resolve({ leadId: LEAD_ID }),
    }),
  );

  expect(
    screen.getByText("Address validation evidence is not yet available."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Parcel details are not yet available."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Structure details are not yet available."),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Parcel candidate map"),
  ).not.toBeInTheDocument();
});

test("keeps the public-record disclaimer visible when geometry is unavailable", async () => {
  const addressResult = database.results.get("property_addresses");
  const parcelResult = database.results.get("parcels");
  const structureResult = database.results.get("structures");
  database.results.set("property_addresses", {
    ...addressResult!,
    data: {
      ...(addressResult!.data as Record<string, unknown>),
      latitude: null,
      longitude: null,
    },
  });
  database.results.set("parcels", {
    ...parcelResult!,
    data: {
      ...(parcelResult!.data as Record<string, unknown>),
      geometry: null,
    },
  });
  database.results.set("structures", {
    ...structureResult!,
    data: {
      ...(structureResult!.data as Record<string, unknown>),
      footprint_geometry: null,
    },
  });

  render(
    await LeadWorkspacePage({
      params: Promise.resolve({ leadId: LEAD_ID }),
    }),
  );

  expect(
    screen.getByText(
      "Parcel geometry and public-record data are analytical aids and are not a legal survey, appraisal, or title report.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Parcel candidate map"),
  ).not.toBeInTheDocument();
});

test("fails safely when property evidence cannot be loaded", async () => {
  database.results.set("parcels", {
    data: null,
    error: { message: "sensitive database detail" },
  });

  await expect(
    LeadWorkspacePage({
      params: Promise.resolve({ leadId: LEAD_ID }),
    }),
  ).rejects.toThrow("Failed to load property profile");
});

test("lists the lead's proposals and links each to its builder", async () => {
  database.results.set(
    "proposals",
    result([
      {
        id: "40000000-0000-4000-8000-000000000002",
        version: 2,
        status: "draft",
        roof_squares: 29.6,
        recommended_tier: "better",
        sent_at: null,
        updated_at: "2026-10-13T15:00:00Z",
      },
      {
        id: "40000000-0000-4000-8000-000000000001",
        version: 1,
        status: "sent",
        roof_squares: 28.4,
        recommended_tier: "best",
        sent_at: "2026-10-12T15:00:00Z",
        updated_at: "2026-10-12T15:00:00Z",
      },
    ]),
  );

  render(
    await LeadWorkspacePage({
      params: Promise.resolve({ leadId: LEAD_ID }),
    }),
  );

  const proposals = screen.getByRole("region", { name: "Proposals" });
  expect(proposals).toHaveTextContent("Version 2");
  expect(proposals).toHaveTextContent("29.6 sq · Better recommended");
  expect(screen.getByRole("link", { name: /Version 1/ })).toHaveAttribute(
    "href",
    `/leads/${LEAD_ID}/proposals/40000000-0000-4000-8000-000000000001`,
  );
  // An open draft is finished before another is started.
  expect(screen.queryByRole("button", { name: "New proposal" })).not.toBeInTheDocument();
  expect(
    database.queries.find((query) => query.table === "proposals")?.filters,
  ).toEqual([
    ["company_id", COMPANY_ID],
    ["lead_id", LEAD_ID],
  ]);
});

test("shows the text conversation with consent and a composer", async () => {
  render(await LeadWorkspacePage({ params: Promise.resolve({ leadId: LEAD_ID }) }));

  const conversation = screen.getByRole("region", { name: "Conversation" });
  expect(conversation).toHaveTextContent("SMS consent on file");
  expect(conversation).toHaveTextContent("Hi Jordan, your estimate is ready.");
  expect(conversation).toHaveTextContent("Delivered");
  expect(conversation).toHaveTextContent("Can someone come look?");
  expect(conversation).toHaveTextContent("SMS to (609) 555-0101");
  expect(screen.getByRole("link", { name: "Text" })).toHaveAttribute("href", "#conversation");
});
