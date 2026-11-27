// @vitest-environment node
import {describe, expect, test, vi} from "vitest";
import {degreesFromPitchRise, toLatLng} from "@/domain/roof-drawing";

const origin = {lat: 39.9, lng: -75.05};
const at = (x: number, y: number) => toLatLng(origin, {x, y});
const row = {
  id: "11111111-2222-4333-8444-555555555555",
  company_id: "c1",
  address: "132 Windsor Ave, Haddon Township, NJ 08108",
  latitude: origin.lat,
  longitude: origin.lng,
  job_jnid: null,
  solar_imagery_date: null,
  drawing: {
    version: 1,
    planes: [{id: "solar-1", vertices: [at(0, 0), at(10, 0), at(10, 4), at(0, 4)], pitchDegrees: degreesFromPitchRise(6), azimuthDegrees: 180, source: "solar", solarSlopedAreaSqft: 480}],
    overrides: {},
    pairModes: {},
  },
  measured: null,
  stories: "two",
  waste_percent: 10,
  squares: 4.8,
  lengths_ft: {eave: 33},
  updated_at: "2026-11-27T15:00:00Z",
};

const auth = vi.hoisted(() => ({user: null as {id: string} | null, role: "manager" as string | null, found: true}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {getUser: async () => ({data: {user: auth.user}})},
    rpc: async () => ({
      data: auth.role ? [{user_id: "u1", company_id: "c1", display_name: "Chris", role: auth.role, is_platform_admin: false}] : [],
    }),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({data: table === "roof_measurements" ? (auth.found ? row : null) : {name: "All Season Roofing"}}),
      };
      return query;
    },
  }),
}));

const {GET} = await import("./route");
const call = (id = row.id) => GET(new Request(`http://x/api/roof-measure/${id}/pdf`), {params: Promise.resolve({measurementId: id})});

describe("roof measurement PDF route", () => {
  test("refuses signed-out and non-CRM users", async () => {
    auth.user = null;
    expect((await call()).status).toBe(401);
    auth.user = {id: "u1"};
    auth.role = "employee";
    expect((await call()).status).toBe(403);
  });

  test("returns 404 for a bad id or a row RLS hides", async () => {
    auth.user = {id: "u1"};
    auth.role = "manager";
    expect((await call("not-a-uuid")).status).toBe(404);
    auth.found = false;
    expect((await call()).status).toBe(404);
    auth.found = true;
  });

  test("renders a PDF for a saved drawing", async () => {
    auth.user = {id: "u1"};
    auth.role = "manager";
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
