// @vitest-environment node
import {renderToBuffer} from "@react-pdf/renderer";
import {writeFileSync} from "node:fs";
import {extractText, getDocumentProxy} from "unpdf";
import {describe, expect, test} from "vitest";
import {degreesFromPitchRise, toLatLng, type RoofPlane} from "@/domain/roof-drawing";
import {buildMeasurementReportModel} from "./measurement-report";
import {MeasurementReportDocument} from "./measurement-report-document";
import type {SavedDrawing} from "./saved-drawing";

const origin = {lat: 39.9, lng: -75.05};
const at = (x: number, y: number) => toLatLng(origin, {x, y});
const plane = (id: string, points: Array<[number, number]>, azimuth: number, rise = 6, surface: RoofPlane["surface"] = "roof"): RoofPlane => ({
  id,
  vertices: points.map(([x, y]) => at(x, y)),
  pitchDegrees: degreesFromPitchRise(rise),
  azimuthDegrees: azimuth,
  source: "adjusted",
  solarSlopedAreaSqft: null,
  surface,
});
// A gable: two 10 m by 4 m faces meeting at a ridge along y = 0, plus a wall face.
const drawing: SavedDrawing = {
  version: 1,
  planes: [
    plane("solar-1", [[0, 0], [10, 0], [10, 4], [0, 4]], 0),
    plane("solar-2", [[0, -4], [10, -4], [10, 0], [0, 0]], 180),
    plane("drawn-1", [[12, 0], [13, 0], [13, 1], [12, 1]], 90, 20, "wall"),
  ],
  overrides: {},
  pairModes: {},
};

describe("roof measurement report", () => {
  test("lays the planes out north up inside the diagram box", () => {
    const model = buildMeasurementReportModel(origin, drawing, {width: 400, height: 200});
    expect(model.planeLabels).toEqual({"solar-1": "1", "solar-2": "2", "drawn-1": "3"});
    const north = model.diagram.planes[0].labelAt;
    const south = model.diagram.planes[1].labelAt;
    expect(north.y).toBeLessThan(south.y);
    const xs = model.diagram.edges.flatMap((edge) => [edge.x1, edge.x2]);
    const ys = model.diagram.edges.flatMap((edge) => [edge.y1, edge.y2]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(400);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
    expect(model.diagram.edges.some((edge) => edge.kind === "ridge")).toBe(true);
    expect(model.report.wallPlaneCount).toBe(1);
  });

  test("prints the summary, lengths and facet tables", async () => {
    const pdf = await renderToBuffer(
      <MeasurementReportDocument
        companyName="All Season Roofing"
        address="132 Windsor Ave, Haddon Township, NJ 08108"
        jobLabel="#4021 · 132 Windsor Ave, Haddon Township"
        preparedOn={new Date("2026-11-27T15:00:00Z")}
        imageryDate="2024-04-02"
        storiesLabel="Two"
        wastePercent={12}
        savedSquares={9.8}
        savedLengthsFt={null}
        sourceLabel="Measured in Rake"
        model={buildMeasurementReportModel(origin, drawing)}
      />,
    );
    if (process.env.ROOF_REPORT_PDF_OUT) writeFileSync(process.env.ROOF_REPORT_PDF_OUT, pdf);
    const {text} = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {mergePages: true});
    expect(text).toContain("Roof measurement report");
    expect(text).toContain("132 Windsor Ave, Haddon Township, NJ 08108");
    expect(text).toContain("Job #4021");
    expect(text).toContain("9.8");
    expect(text).toContain("6/12");
    expect(text).toContain("Ridge");
    expect(text).toContain("12% (chosen)");
    expect(text).toContain("wall, not counted");
    expect(text).toContain("imagery dated 2024-04-02");
    expect(text).toContain("Page 2 of 2");
  });
});
