import {
  buildRoofMeasurementReport,
  computeRoofEdges,
  isWall,
  roofEdgeKinds,
  toLocal,
  type LatLng,
  type RoofEdgeKind,
  type RoofMeasurementReport,
} from "@/domain/roof-drawing";
import type {SavedDrawing} from "./saved-drawing";

// Everything the printed measurement report needs, worked out from a saved
// drawing: the plane outlines and edges in page coordinates (north up) and
// the same totals the measuring page shows.

export type ReportDiagram = {
  width: number;
  height: number;
  planes: Array<{label: string; points: string; wall: boolean; labelAt: {x: number; y: number}; pitchRise: number}>;
  edges: Array<{kind: RoofEdgeKind; x1: number; y1: number; x2: number; y2: number; lengthFt: number; labelAt: {x: number; y: number}}>;
  /** Feet per page point, for the scale bar. */
  feetPerPoint: number;
};

export type MeasurementReportModel = {
  report: RoofMeasurementReport;
  diagram: ReportDiagram;
  /** Plane ids in the order they are numbered on the diagram. */
  planeLabels: Record<string, string>;
};

const FT_PER_M = 3.28084;
const DIAGRAM_PADDING = 18;

export function buildMeasurementReportModel(
  origin: LatLng,
  drawing: SavedDrawing,
  size: {width: number; height: number} = {width: 520, height: 340},
): MeasurementReportModel {
  const planes = drawing.planes;
  const edges = computeRoofEdges(origin, planes, drawing.overrides, drawing.pairModes);
  const report = buildRoofMeasurementReport(origin, planes, edges);
  const planeLabels = Object.fromEntries(planes.map((plane, index) => [plane.id, String(index + 1)]));

  const local = planes.map((plane) => plane.vertices.map((vertex) => toLocal(origin, vertex)));
  const all = local.flat();
  const minX = Math.min(...all.map((p) => p.x), 0);
  const maxX = Math.max(...all.map((p) => p.x), 1);
  const minY = Math.min(...all.map((p) => p.y), 0);
  const maxY = Math.max(...all.map((p) => p.y), 1);
  const scale = Math.min(
    (size.width - DIAGRAM_PADDING * 2) / Math.max(maxX - minX, 1),
    (size.height - DIAGRAM_PADDING * 2) / Math.max(maxY - minY, 1),
  );
  const offsetX = (size.width - (maxX - minX) * scale) / 2;
  const offsetY = (size.height - (maxY - minY) * scale) / 2;
  const page = (point: {x: number; y: number}) => ({
    x: round(offsetX + (point.x - minX) * scale),
    // North up: page y grows downwards.
    y: round(offsetY + (maxY - point.y) * scale),
  });

  return {
    report,
    planeLabels,
    diagram: {
      width: size.width,
      height: size.height,
      feetPerPoint: FT_PER_M / scale,
      planes: planes.map((plane, index) => {
        const points = local[index].map(page);
        const center = centroid(local[index]);
        return {
          label: planeLabels[plane.id],
          wall: isWall(plane),
          points: points.map((p) => `${p.x},${p.y}`).join(" "),
          labelAt: page(center),
          pitchRise: report.planes.find((row) => row.id === plane.id)?.pitchRise ?? 0,
        };
      }),
      edges: edges.map((edge) => {
        const start = page(toLocal(origin, edge.start));
        const end = page(toLocal(origin, edge.end));
        return {
          kind: edge.kind,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          lengthFt: edge.trueLengthFt,
          labelAt: {x: round((start.x + end.x) / 2), y: round((start.y + end.y) / 2)},
        };
      }),
    },
  };
}

/** Lengths to print: every kind, in the report's fixed order, with saved values winning. */
export function reportLengths(report: RoofMeasurementReport, saved: Partial<Record<RoofEdgeKind, number>> | null) {
  return roofEdgeKinds.map((kind) => ({kind, feet: saved?.[kind] ?? report.lengthsFt[kind]}));
}

function centroid(points: Array<{x: number; y: number}>) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  });
  if (Math.abs(area) < 1e-9) {
    return {x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length};
  }
  return {x: cx / (3 * area), y: cy / (3 * area)};
}

const round = (value: number) => Math.round(value * 10) / 10;
