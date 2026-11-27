import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import {degreesFromPitchRise, toLatLng} from "@/domain/roof-drawing";
import {MEASUREMENT_HANDOFF_KEY} from "./measure-pricing";

vi.mock("./roof-plane-map-loader", () => ({
  RoofPlaneMap: ({planes, edges, dispatch}: {planes: Array<{id: string}>; edges: unknown[]; dispatch: (action: unknown) => void}) => (
    <div data-testid="map">
      {planes.length} planes, {edges.length} edges
      {planes.map((plane) => (
        <button key={plane.id} type="button" onClick={() => dispatch({type: "selectPlane", planeId: plane.id})}>select {plane.id}</button>
      ))}
    </div>
  ),
}));

const {MeasureWorkbench} = await import("./measure-workbench");

const center = {lat: 40.35, lng: -74.07};
const at = (x: number, y: number) => toLatLng(center, {x, y});
const segment = (azimuth: number, y0: number, y1: number) => {
  const sw = at(-5, Math.min(y0, y1));
  const ne = at(5, Math.max(y0, y1));
  const mid = at(0, (y0 + y1) / 2);
  return {
    pitchDegrees: degreesFromPitchRise(6),
    azimuthDegrees: azimuth,
    stats: {areaMeters2: 44.72, groundAreaMeters2: 40},
    center: {latitude: mid.lat, longitude: mid.lng},
    boundingBox: {sw: {latitude: sw.lat, longitude: sw.lng}, ne: {latitude: ne.lat, longitude: ne.lng}},
    planeHeightAtCenterMeters: 36.2,
  };
};
const lookupResponse = {
  location: center,
  formattedAddress: "18 Harbor View Dr, Red Bank, NJ 07701, USA",
  solar: {
    status: "success" as const,
    cached: false,
    raw: {
      name: "buildings/test",
      center: {latitude: center.lat, longitude: center.lng},
      imageryDate: {year: 2024, month: 4, day: 2},
      imageryQuality: "HIGH",
      solarPotential: {
        buildingStats: {areaMeters2: 100},
        roofSegmentStats: [segment(0, 0, 4), segment(180, -4, 0)],
      },
    },
  },
  groundElevationMeters: 30,
  elevationNote: null,
};

afterEach(() => window.sessionStorage.clear());

describe("roof measuring sandbox", () => {
  test("loads Solar planes, prices the blended squares, and switches to the drawing once edited", async () => {
    const fetchLookup = vi.fn(async () => lookupResponse);
    render(<MeasureWorkbench fetchLookup={fetchLookup} />);
    fireEvent.change(screen.getByLabelText(/address, or latitude/i), {target: {value: "18 Harbor View Drive, Red Bank NJ"}});
    fireEvent.click(screen.getByRole("button", {name: "Look up roof"}));

    await waitFor(() => expect(screen.getByTestId("map")).toHaveTextContent("2 planes"));
    expect(fetchLookup).toHaveBeenCalledWith("18 Harbor View Drive, Red Bank NJ", "HIGH");
    expect(screen.getByRole("status")).toHaveTextContent("2 Solar segments");
    // Facet sum 9.6 squares, building 10.8, blended 10.2.
    expect(screen.getByText(/Price on 10\.2 squares \(Solar \(blended\)\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Stories")).toHaveDisplayValue(/Solar guess: Two stories/);

    fireEvent.click(screen.getByRole("button", {name: "select solar-1"}));
    fireEvent.change(screen.getByLabelText("Pitch rise per 12"), {target: {value: "9"}});
    expect(screen.getByText(/\(Drawing\)/)).toBeInTheDocument();
    expect(screen.getByText(/Would trigger/)).toBeInTheDocument();
  });

  test("a typed measured report wins and the result can be handed to the assessment sandbox", async () => {
    render(<MeasureWorkbench fetchLookup={async () => lookupResponse} />);
    fireEvent.change(screen.getByLabelText(/address, or latitude/i), {target: {value: "40.35, -74.07"}});
    fireEvent.click(screen.getByRole("button", {name: "Look up roof"}));
    await screen.findByTestId("map");

    const tier3 = screen.getByRole("heading", {name: /measured report \(tier 3\)/i}).parentElement!;
    fireEvent.change(within(tier3).getByLabelText("Total sq ft"), {target: {value: "1100"}});
    expect(screen.getByText(/Price on 11\.0 squares \(Measured report\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Use in assessment sandbox"}));
    const saved = JSON.parse(window.sessionStorage.getItem(MEASUREMENT_HANDOFF_KEY)!);
    expect(saved).toMatchObject({squares: 11, tier: "measured", stories: "two"});
    expect(screen.getByRole("link", {name: /open the customer result/i})).toHaveAttribute("href", "/roof-estimate/dev-assessment?result=ready");
  });

  test("without Solar coverage the aerial still loads for drawing by hand", async () => {
    render(<MeasureWorkbench fetchLookup={async () => ({...lookupResponse, solar: {status: "no_coverage" as const, cached: false}})} />);
    fireEvent.change(screen.getByLabelText(/address, or latitude/i), {target: {value: "somewhere"}});
    fireEvent.click(screen.getByRole("button", {name: "Look up roof"}));
    expect(await screen.findByTestId("map")).toHaveTextContent("0 planes");
    expect(screen.getByRole("status")).toHaveTextContent(/no coverage/i);
  });

  test("shows lookup errors", async () => {
    render(<MeasureWorkbench fetchLookup={async () => { throw new Error("GOOGLE_MAPS_API_KEY is not set in .env.local"); }} />);
    fireEvent.change(screen.getByLabelText(/address, or latitude/i), {target: {value: "x st"}});
    fireEvent.click(screen.getByRole("button", {name: "Look up roof"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("GOOGLE_MAPS_API_KEY");
  });
});
