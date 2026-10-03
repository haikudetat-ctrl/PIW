import { describe, expect, test, vi } from "vitest";
import { loadPreviewView, type PreviewReadDependencies } from "./preview-read-model";

const scope = {companyId: "11111111-1111-4111-8111-111111111111", tokenHash: "a".repeat(64)};
const row = {
  id: "22222222-2222-4222-8222-222222222222",
  property_id: "33333333-3333-4333-8333-333333333333",
  status: "active",
  expires_at: "2099-01-01T00:00:00.000Z",
  submitted_address: "1 Main St, Newark, NJ 07102",
  canonical_address: "1 Main St, Newark, NJ 07102, USA",
  address_mode: "google",
  latitude: 40.7357,
  longitude: -74.1724,
  measurement_status: "ready",
  reveal_mode: "full",
  roof_insight_id: "44444444-4444-4444-8444-444444444444",
  responses: {reason: "storm_damage", timeline: "asap"},
  saved_email: null,
  campaign: "weather-report",
  presentation_key: "weather-report",
};

function deps(overrides: Partial<PreviewReadDependencies> = {}) {
  return {
    loadPreviewRow: vi.fn(async () => row),
    loadRoofInsight: vi.fn(async () => ({
      totalRoofSqft: 2_449,
      roofSegments: [{pitchDegrees: 22, azimuthDegrees: 180, areaSqft: 1200}, {pitchDegrees: 22, azimuthDegrees: 0, areaSqft: 1249}],
    })),
    now: () => new Date("2026-10-03T12:00:00.000Z"),
    ...overrides,
  } satisfies PreviewReadDependencies;
}

describe("loadPreviewView", () => {
  test("returns the reveal view with roof size and complexity, and nothing sensitive", async () => {
    const view = await loadPreviewView(scope, deps());
    expect(view).toEqual({
      status: "active",
      address: {display: "1 Main St, Newark, NJ 07102, USA", googleConfirmed: true},
      image: {state: "ready"},
      roof: {state: "ready", squares: 24, complexity: "simple"},
      answered: ["reason", "timeline"],
      savedEmail: false,
      campaign: "weather-report",
      presentationKey: "weather-report",
    });
    const serialized = JSON.stringify(view);
    for (const forbidden of ["40.7357", "-74.1724", "ChIJ", row.property_id, row.roof_insight_id, row.id]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("binds the insight to the preview's company and linked insight", async () => {
    const d = deps();
    await loadPreviewView(scope, d);
    expect(d.loadRoofInsight).toHaveBeenCalledWith({
      companyId: scope.companyId,
      roofInsightId: row.roof_insight_id,
    });
  });

  test.each([
    ["pending", {state: "pending"}],
    ["no_coverage", {state: "review_required"}],
    ["unavailable", {state: "review_required"}],
    ["skipped", {state: "skipped"}],
  ])("maps measurement status %s", async (measurementStatus, roof) => {
    const view = await loadPreviewView(scope, deps({
      loadPreviewRow: vi.fn(async () => ({...row, measurement_status: measurementStatus, roof_insight_id: null})),
    }));
    expect(view?.roof).toEqual(roof);
  });

  test("shows a manual address without Google confirmation or imagery", async () => {
    const view = await loadPreviewView(scope, deps({
      loadPreviewRow: vi.fn(async () => ({
        ...row, address_mode: "manual", canonical_address: null, latitude: null, longitude: null,
        measurement_status: "unavailable", roof_insight_id: null,
      })),
    }));
    expect(view?.address).toEqual({display: "1 Main St, Newark, NJ 07102", googleConfirmed: false});
    expect(view?.image).toEqual({state: "unavailable"});
  });

  test("treats a missing insight row as review required rather than inventing a size", async () => {
    const view = await loadPreviewView(scope, deps({loadRoofInsight: vi.fn(async () => null)}));
    expect(view?.roof).toEqual({state: "review_required"});
  });

  test("returns null for unknown or expired previews", async () => {
    await expect(loadPreviewView(scope, deps({loadPreviewRow: vi.fn(async () => null)}))).resolves.toBeNull();
    await expect(loadPreviewView(scope, deps({
      loadPreviewRow: vi.fn(async () => ({...row, expires_at: "2026-10-01T00:00:00.000Z"})),
    }))).resolves.toBeNull();
    await expect(loadPreviewView(scope, deps({
      loadPreviewRow: vi.fn(async () => ({...row, status: "expired"})),
    }))).resolves.toBeNull();
  });
});
