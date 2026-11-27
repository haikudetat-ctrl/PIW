// Roof drawing model for the dev-only measuring sandbox
// (/roof-estimate/dev-assessment/measure). Pure geometry: no network, no
// database, and nothing here feeds the live customer price path.
//
// Three helper tiers produce a roof measurement:
//   1. Solar: Google Building Insights segments, placed as azimuth-aligned
//      rectangles that keep each segment's own ground area and pitch.
//   2. Drawn: the planes after a person moves corners, adds or removes
//      corners and planes, and sets pitch. Authoritative once anything is
//      edited.
//   3. Measured: numbers typed in from a measured report (Roofr, EagleView).
//      Overrides the other two for pricing when present.
//
// Coordinates are converted to a local east/north plane in metres around an
// origin. At house scale (<100 m) the error from that flat projection is far
// below what aerial imagery can resolve.

import {z} from "zod";

export const SQFT_PER_M2 = 10.7639;
export const FT_PER_M = 3.28084;

export type LatLng = {lat: number; lng: number};
export type LocalPoint = {x: number; y: number};

export type RoofPlaneSource = "solar" | "adjusted" | "drawn";

export type RoofPlane = {
  id: string;
  vertices: LatLng[];
  pitchDegrees: number;
  /** Compass direction the plane faces (downslope), 0 = north, 90 = east. */
  azimuthDegrees: number;
  source: RoofPlaneSource;
  /** Solar's own sloped area for the segment, kept for comparison. */
  solarSlopedAreaSqft: number | null;
};

export const roofEdgeKinds = [
  "eave",
  "rake",
  "ridge",
  "hip",
  "valley",
  "step_flashing",
  "wall_flashing",
  "transition",
] as const;
export type RoofEdgeKind = (typeof roofEdgeKinds)[number];

export const roofEdgeKindLabels: Record<RoofEdgeKind, string> = {
  eave: "Eave",
  rake: "Rake",
  ridge: "Ridge",
  hip: "Hip",
  valley: "Valley",
  step_flashing: "Step flashing",
  wall_flashing: "Wall flashing",
  transition: "Pitch change",
};

export type RoofEdge = {
  id: string;
  planeIds: [string] | [string, string];
  start: LatLng;
  end: LatLng;
  planLengthFt: number;
  trueLengthFt: number;
  kind: RoofEdgeKind;
  autoKind: RoofEdgeKind;
  overridden: boolean;
  /** The automatic label is a guess worth a look (for example an unshared top edge). */
  needsReview: boolean;
};

// ---------------------------------------------------------------------------
// Projection

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQUATOR = 111_320;

export function toLocal(origin: LatLng, point: LatLng): LocalPoint {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * M_PER_DEG_LNG_EQUATOR * cosLat,
    y: (point.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

export function toLatLng(origin: LatLng, point: LocalPoint): LatLng {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return {
    lat: origin.lat + point.y / M_PER_DEG_LAT,
    lng: origin.lng + point.x / (M_PER_DEG_LNG_EQUATOR * cosLat),
  };
}

export function distanceMeters(a: LatLng, b: LatLng) {
  const p = toLocal(a, b);
  return Math.hypot(p.x, p.y);
}

// ---------------------------------------------------------------------------
// Pitch helpers

const DEG = Math.PI / 180;

export function pitchRiseFromDegrees(degrees: number) {
  return 12 * Math.tan(degrees * DEG);
}

export function degreesFromPitchRise(rise: number) {
  return Math.atan(rise / 12) / DEG;
}

/** Nearest whole x/12, as Roofr reports it. */
export function roundedPitchRise(degrees: number) {
  return Math.max(0, Math.round(pitchRiseFromDegrees(degrees)));
}

function downslope(azimuthDegrees: number): LocalPoint {
  const a = azimuthDegrees * DEG;
  return {x: Math.sin(a), y: Math.cos(a)};
}

function normalizeAzimuth(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Polygon helpers

function signedArea(points: LocalPoint[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function centroid(points: LocalPoint[]): LocalPoint {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-9) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return {x: cx / (6 * area), y: cy / (6 * area)};
}

export function planAreaSqft(origin: LatLng, vertices: LatLng[]) {
  if (vertices.length < 3) return 0;
  return Math.abs(signedArea(vertices.map((v) => toLocal(origin, v)))) * SQFT_PER_M2;
}

export function slopedAreaSqft(origin: LatLng, plane: Pick<RoofPlane, "vertices" | "pitchDegrees">) {
  const cos = Math.cos(Math.min(Math.max(plane.pitchDegrees, 0), 80) * DEG);
  return planAreaSqft(origin, plane.vertices) / cos;
}

/**
 * Downslope guess for a plane someone drew by hand: perpendicular to its
 * longest edge, pointing out across that edge. Usually the eave; editable.
 */
export function guessAzimuthForDrawnPlane(origin: LatLng, vertices: LatLng[]) {
  const points = vertices.map((v) => toLocal(origin, v));
  if (points.length < 2) return 180;
  const c = centroid(points);
  let best = {length: -1, mid: points[0], dir: {x: 1, y: 0}};
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.length) {
      best = {length, mid: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, dir: {x: (b.x - a.x) / length, y: (b.y - a.y) / length}};
    }
  }
  let normal = {x: best.dir.y, y: -best.dir.x};
  if ((best.mid.x - c.x) * normal.x + (best.mid.y - c.y) * normal.y < 0) {
    normal = {x: -normal.x, y: -normal.y};
  }
  return normalizeAzimuth(Math.atan2(normal.x, normal.y) / DEG);
}

// ---------------------------------------------------------------------------
// Tier 1: Google Solar Building Insights

const solarLatLngSchema = z.object({latitude: z.number(), longitude: z.number()});
const solarBoxSchema = z.object({sw: solarLatLngSchema, ne: solarLatLngSchema});
const solarStatsSchema = z.object({
  areaMeters2: z.number().nonnegative(),
  groundAreaMeters2: z.number().nonnegative().optional(),
});

export const solarDrawingResponseSchema = z.object({
  name: z.string().min(1),
  center: solarLatLngSchema,
  boundingBox: solarBoxSchema.optional(),
  imageryDate: z.object({year: z.number(), month: z.number(), day: z.number()}).optional(),
  imageryQuality: z.string().optional(),
  solarPotential: z.object({
    wholeRoofStats: solarStatsSchema.optional(),
    buildingStats: solarStatsSchema.optional(),
    roofSegmentStats: z.array(z.object({
      pitchDegrees: z.number(),
      azimuthDegrees: z.number(),
      stats: solarStatsSchema,
      center: solarLatLngSchema,
      boundingBox: solarBoxSchema,
      planeHeightAtCenterMeters: z.number().optional(),
    })).min(1),
  }),
});

export type SolarSegment = {
  index: number;
  pitchDegrees: number;
  azimuthDegrees: number;
  center: LatLng;
  sw: LatLng;
  ne: LatLng;
  slopedAreaSqft: number;
  groundAreaSqft: number;
  /** Elevation of the plane's centre above sea level, not above ground. */
  planeHeightAtCenterMeters: number | null;
};

export type SolarDrawingInsight = {
  buildingName: string;
  center: LatLng;
  imageryDate: string | null;
  imageryQuality: string | null;
  segments: SolarSegment[];
  facetSumSqft: number;
  buildingAreaSqft: number | null;
};

const ll = (value: {latitude: number; longitude: number}): LatLng => ({lat: value.latitude, lng: value.longitude});

export function parseSolarForDrawing(raw: unknown): SolarDrawingInsight {
  const parsed = solarDrawingResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Google Solar returned a response without roof segment geometry");
  const data = parsed.data;
  const segments = data.solarPotential.roofSegmentStats.map((segment, index): SolarSegment => {
    const pitch = Math.min(Math.max(segment.pitchDegrees, 0), 80);
    const ground = segment.stats.groundAreaMeters2 ?? segment.stats.areaMeters2 * Math.cos(pitch * DEG);
    return {
      index,
      pitchDegrees: pitch,
      azimuthDegrees: normalizeAzimuth(segment.azimuthDegrees),
      center: ll(segment.center),
      sw: ll(segment.boundingBox.sw),
      ne: ll(segment.boundingBox.ne),
      slopedAreaSqft: segment.stats.areaMeters2 * SQFT_PER_M2,
      groundAreaSqft: ground * SQFT_PER_M2,
      planeHeightAtCenterMeters: segment.planeHeightAtCenterMeters ?? null,
    };
  });
  const date = data.imageryDate;
  return {
    buildingName: data.name,
    center: ll(data.center),
    imageryDate: date ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : null,
    imageryQuality: data.imageryQuality ?? null,
    segments,
    facetSumSqft: segments.reduce((sum, s) => sum + s.slopedAreaSqft, 0),
    buildingAreaSqft: data.solarPotential.buildingStats ? data.solarPotential.buildingStats.areaMeters2 * SQFT_PER_M2 : null,
  };
}

const MAX_ASPECT = 6;

/**
 * Width (along the eave) and depth (up the slope), in metres, of a rectangle
 * facing `azimuthDegrees` whose axis-aligned box matches Solar's box, then
 * scaled so its ground area equals Solar's ground area for the segment.
 * Solar's boxes are axis-aligned around irregular pixel masks, so the fitted
 * rectangle starts too big; the scale keeps Solar's area fixed.
 */
export function fitSegmentRectangle(input: {
  azimuthDegrees: number;
  boxWidthM: number;
  boxHeightM: number;
  groundAreaM2: number;
}) {
  const theta = input.azimuthDegrees * DEG;
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const det = c * c - s * s;
  let width = 0;
  let depth = 0;
  if (Math.abs(det) > 0.2) {
    width = (c * input.boxWidthM - s * input.boxHeightM) / det;
    depth = (c * input.boxHeightM - s * input.boxWidthM) / det;
  }
  if (!(width > 0) || !(depth > 0)) {
    // Diagonal planes (azimuth near 45 degrees) leave the box ambiguous.
    width = Math.sqrt(input.groundAreaM2);
    depth = width;
  }
  if (width / depth > MAX_ASPECT) depth = width / MAX_ASPECT;
  if (depth / width > MAX_ASPECT) width = depth / MAX_ASPECT;
  const scale = input.groundAreaM2 > 0 ? Math.sqrt(input.groundAreaM2 / (width * depth)) : 1;
  return {width: width * scale, depth: depth * scale};
}

export function planeFromSolarSegment(origin: LatLng, segment: SolarSegment): RoofPlane {
  const sw = toLocal(origin, segment.sw);
  const ne = toLocal(origin, segment.ne);
  const center = toLocal(origin, segment.center);
  const {width, depth} = fitSegmentRectangle({
    azimuthDegrees: segment.azimuthDegrees,
    boxWidthM: Math.abs(ne.x - sw.x),
    boxHeightM: Math.abs(ne.y - sw.y),
    groundAreaM2: segment.groundAreaSqft / SQFT_PER_M2,
  });
  const d = downslope(segment.azimuthDegrees);
  const e = {x: d.y, y: -d.x};
  const corner = (along: number, down: number): LocalPoint => ({
    x: center.x + e.x * along * width / 2 + d.x * down * depth / 2,
    y: center.y + e.y * along * width / 2 + d.y * down * depth / 2,
  });
  let points = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
  if (signedArea(points) < 0) points = points.reverse();
  return {
    id: `solar-${segment.index + 1}`,
    vertices: points.map((p) => toLatLng(origin, p)),
    pitchDegrees: segment.pitchDegrees,
    azimuthDegrees: segment.azimuthDegrees,
    source: "solar",
    solarSlopedAreaSqft: segment.slopedAreaSqft,
  };
}

/** Segments under this sloped area are Solar noise (vents, dormers it half sees). */
export const MIN_SOLAR_SEGMENT_SQFT = 15;

export function planesFromSolar(insight: SolarDrawingInsight, origin: LatLng = insight.center) {
  return insight.segments
    .filter((segment) => segment.slopedAreaSqft >= MIN_SOLAR_SEGMENT_SQFT)
    .map((segment) => planeFromSolarSegment(origin, segment));
}

export type SolarSquaresTier = {
  facetSumSquares: number;
  buildingSquares: number | null;
  blendedSquares: number;
};

/**
 * Live pricing uses the facet sum. On 12 Roofr-matched jobs (Nov 21 backtest)
 * the midpoint of facet sum and building area cut median error from 9.8% to
 * 6.3%. Twelve jobs is directional, so both stay visible.
 */
export function solarSquares(insight: SolarDrawingInsight): SolarSquaresTier {
  const facet = insight.facetSumSqft / 100;
  const building = insight.buildingAreaSqft === null ? null : insight.buildingAreaSqft / 100;
  return {
    facetSumSquares: facet,
    buildingSquares: building,
    blendedSquares: building === null ? facet : (facet + building) / 2,
  };
}

// ---------------------------------------------------------------------------
// Story estimate (tier 1 helper)

export type StoryEstimate = {
  stories: "one" | "two" | "three_plus" | "unknown";
  eaveHeightFt: number | null;
  note: string;
};

const STORY_HEIGHT_M = 3.0;

/**
 * Solar plane heights are elevations above sea level, so a story count needs
 * the ground elevation at the building (Google Elevation API). Uses the
 * largest plane's estimated eave height: centre height minus half its rise.
 */
export function estimateStories(insight: SolarDrawingInsight, groundElevationMeters: number | null): StoryEstimate {
  if (groundElevationMeters === null) {
    return {stories: "unknown", eaveHeightFt: null, note: "No ground elevation, so Solar heights cannot be turned into stories."};
  }
  const candidates = insight.segments.filter((s) => s.planeHeightAtCenterMeters !== null);
  if (candidates.length === 0) {
    return {stories: "unknown", eaveHeightFt: null, note: "Solar returned no plane heights."};
  }
  const largest = candidates.reduce((a, b) => (b.groundAreaSqft > a.groundAreaSqft ? b : a));
  const groundM2 = largest.groundAreaSqft / SQFT_PER_M2;
  const depthM = Math.sqrt(groundM2); // rough: square plane
  const eave = (largest.planeHeightAtCenterMeters as number) - groundElevationMeters - (depthM / 2) * Math.tan(largest.pitchDegrees * DEG);
  if (!Number.isFinite(eave) || eave <= 0.5 || eave > 20) {
    return {stories: "unknown", eaveHeightFt: Number.isFinite(eave) ? eave * FT_PER_M : null, note: "Eave height came out implausible; check the ground elevation."};
  }
  const count = eave / STORY_HEIGHT_M;
  const stories = count < 1.5 ? "one" : count < 2.5 ? "two" : "three_plus";
  return {stories, eaveHeightFt: eave * FT_PER_M, note: "Rough guess from Solar plane height minus ground elevation."};
}

// ---------------------------------------------------------------------------
// Tier 2: edges between drawn planes

/** Corners closer than this are treated as the same point when snapping. */
export const SNAP_TOLERANCE_M = 0.6;
/** Edges closer than this (and nearly parallel) are treated as shared. */
export const SHARED_EDGE_TOLERANCE_M = 0.75;
const SHARED_EDGE_MAX_ANGLE_DEG = 12;
const MIN_PIECE_M = 0.3;
const FLAT_PITCH_DEG = degreesFromPitchRise(2);

type LocalPlane = {
  plane: RoofPlane;
  points: LocalPoint[];
  center: LocalPoint;
  down: LocalPoint;
};

type Piece = {
  planeIds: [string] | [string, string];
  a: LocalPoint;
  b: LocalPoint;
  key: string;
};

function localPlanes(origin: LatLng, planes: RoofPlane[]): LocalPlane[] {
  return planes
    .filter((plane) => plane.vertices.length >= 3)
    .map((plane) => {
      const points = plane.vertices.map((v) => toLocal(origin, v));
      return {plane, points, center: centroid(points), down: downslope(plane.azimuthDegrees)};
    });
}

function edgesOf(points: LocalPoint[]) {
  return points.map((a, i) => ({a, b: points[(i + 1) % points.length], index: i}));
}

function overlapInterval(
  a: LocalPoint,
  b: LocalPoint,
  c: LocalPoint,
  d: LocalPoint,
): [number, number] | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const otherLength = Math.hypot(d.x - c.x, d.y - c.y);
  if (length < 1e-6 || otherLength < 1e-6) return null;
  const u = {x: (b.x - a.x) / length, y: (b.y - a.y) / length};
  const v = {x: (d.x - c.x) / otherLength, y: (d.y - c.y) / otherLength};
  if (Math.abs(u.x * v.x + u.y * v.y) < Math.cos(SHARED_EDGE_MAX_ANGLE_DEG * DEG)) return null;
  // Positions of the other edge's ends along this edge, then the part of
  // this edge both cover. The other edge may be longer or offset.
  const tc = (c.x - a.x) * u.x + (c.y - a.y) * u.y;
  const td = (d.x - a.x) * u.x + (d.y - a.y) * u.y;
  const lo = Math.max(0, Math.min(tc, td));
  const hi = Math.min(length, Math.max(tc, td));
  if (hi - lo < MIN_PIECE_M) return null;
  const pointOnOther = (t: number): LocalPoint => {
    const k = (t - tc) / (td - tc);
    return {x: c.x + (d.x - c.x) * k, y: c.y + (d.y - c.y) * k};
  };
  const gap = (p: LocalPoint) => Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
  if (gap(pointOnOther(lo)) > SHARED_EDGE_TOLERANCE_M || gap(pointOnOther(hi)) > SHARED_EDGE_TOLERANCE_M) return null;
  return [lo, hi];
}

function splitEdges(planes: LocalPlane[]): Piece[] {
  const pieces: Piece[] = [];
  planes.forEach((self) => {
    edgesOf(self.points).forEach(({a, b, index}) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < MIN_PIECE_M) return;
      const u = {x: (b.x - a.x) / length, y: (b.y - a.y) / length};
      const at = (t: number): LocalPoint => ({x: a.x + u.x * t, y: a.y + u.y * t});
      const shared: Array<{lo: number; hi: number; other: string}> = [];
      planes.forEach((other) => {
        if (other.plane.id === self.plane.id) return;
        edgesOf(other.points).forEach((edge) => {
          const interval = overlapInterval(a, b, edge.a, edge.b);
          if (interval) shared.push({lo: interval[0], hi: interval[1], other: other.plane.id});
        });
      });
      shared.sort((x, y) => x.lo - y.lo);
      let cursor = 0;
      let freeIndex = 0;
      const pushFree = (lo: number, hi: number) => {
        if (hi - lo < MIN_PIECE_M) return;
        pieces.push({planeIds: [self.plane.id], a: at(lo), b: at(hi), key: `${self.plane.id}:${index}:${freeIndex}`});
        freeIndex += 1;
      };
      shared.forEach((item) => {
        if (item.lo > cursor) pushFree(cursor, item.lo);
        // Each shared piece is reported once, from the plane whose id sorts first.
        if (self.plane.id < item.other && item.hi - Math.max(item.lo, cursor) >= MIN_PIECE_M) {
          pieces.push({
            planeIds: [self.plane.id, item.other],
            a: at(Math.max(item.lo, cursor)),
            b: at(item.hi),
            key: `${self.plane.id}~${item.other}:${index}`,
          });
        }
        cursor = Math.max(cursor, item.hi);
      });
      if (cursor < length) pushFree(cursor, length);
    });
  });
  return pieces;
}

type SideInfo = {high: boolean; low: boolean; alongSlope: number; flat: boolean};

function sideOf(plane: LocalPlane, mid: LocalPoint, u: LocalPoint): SideInfo {
  const offset = (mid.x - plane.center.x) * plane.down.x + (mid.y - plane.center.y) * plane.down.y;
  const alongSlope = Math.abs(u.x * plane.down.x + u.y * plane.down.y);
  return {high: offset < -0.05, low: offset > 0.05, alongSlope, flat: plane.plane.pitchDegrees < FLAT_PITCH_DEG};
}

function classify(pieceSides: SideInfo[]): {kind: RoofEdgeKind; needsReview: boolean} {
  if (pieceSides.length === 1) {
    const [s] = pieceSides;
    if (s.flat) return {kind: "eave", needsReview: false};
    if (s.alongSlope > 0.5) return {kind: "rake", needsReview: false};
    if (s.low) return {kind: "eave", needsReview: false};
    // An open top edge is either a ridge whose other side was never drawn or
    // a wall. Solar misses planes often enough that it is worth a look.
    return {kind: "ridge", needsReview: true};
  }
  const [a, b] = pieceSides;
  const contour = a.alongSlope < 0.35 && b.alongSlope < 0.35;
  if (a.high && b.high) return {kind: contour ? "ridge" : "hip", needsReview: false};
  if (a.low && b.low) return {kind: "valley", needsReview: false};
  if ((a.high && b.low) || (a.low && b.high)) {
    return contour ? {kind: "transition", needsReview: false} : {kind: "step_flashing", needsReview: true};
  }
  return {kind: contour ? "ridge" : "hip", needsReview: true};
}

function trueLength(plan: number, u: LocalPoint, planes: LocalPlane[]) {
  // Slope of the edge as it runs across each plane; averaged for shared edges.
  const slopes = planes.map((p) => Math.tan(Math.min(p.plane.pitchDegrees, 80) * DEG) * (u.x * p.down.x + u.y * p.down.y));
  const slope = slopes.reduce((s, v) => s + Math.abs(v), 0) / slopes.length;
  return plan * Math.sqrt(1 + slope * slope);
}

export function computeRoofEdges(
  origin: LatLng,
  planes: RoofPlane[],
  overrides: Record<string, RoofEdgeKind> = {},
): RoofEdge[] {
  const locals = localPlanes(origin, planes);
  const byId = new Map(locals.map((p) => [p.plane.id, p]));
  return splitEdges(locals).map((piece) => {
    const length = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y);
    const u = {x: (piece.b.x - piece.a.x) / length, y: (piece.b.y - piece.a.y) / length};
    const mid = {x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2};
    const owners = piece.planeIds.map((id) => byId.get(id) as LocalPlane);
    const auto = classify(owners.map((owner) => sideOf(owner, mid, u)));
    const override = overrides[piece.key];
    return {
      id: piece.key,
      planeIds: piece.planeIds,
      start: toLatLng(origin, piece.a),
      end: toLatLng(origin, piece.b),
      planLengthFt: length * FT_PER_M,
      trueLengthFt: trueLength(length, u, owners) * FT_PER_M,
      kind: override ?? auto.kind,
      autoKind: auto.kind,
      overridden: override !== undefined && override !== auto.kind,
      needsReview: override === undefined && auto.needsReview,
    };
  });
}

/** Moves `point` onto the nearest corner of another plane when within tolerance. */
export function snapToNearbyVertex(origin: LatLng, point: LatLng, planes: RoofPlane[], ignorePlaneId: string) {
  let best: {vertex: LatLng; distance: number} | null = null;
  const p = toLocal(origin, point);
  planes.forEach((plane) => {
    if (plane.id === ignorePlaneId) return;
    plane.vertices.forEach((vertex) => {
      const v = toLocal(origin, vertex);
      const distance = Math.hypot(v.x - p.x, v.y - p.y);
      if (distance <= SNAP_TOLERANCE_M && (!best || distance < best.distance)) best = {vertex, distance};
    });
  });
  return best ? (best as {vertex: LatLng}).vertex : point;
}

// ---------------------------------------------------------------------------
// Report

export type MeasuredReportInput = {
  source: string;
  totalSqft: number | null;
  predominantPitchRise: number | null;
  lengthsFt: Partial<Record<RoofEdgeKind, number>>;
};

export type RoofMeasurementReport = {
  planeCount: number;
  editedPlaneCount: number;
  totalSlopedSqft: number;
  totalPlanSqft: number;
  squares: number;
  predominantPitchRise: number | null;
  pitchBreakdown: Array<{pitchRise: number; sqft: number; share: number}>;
  lengthsFt: Record<RoofEdgeKind, number>;
  reviewEdgeCount: number;
  suggestedWastePercent: number;
  wasteTable: Array<{percent: number; squares: number; bundles: number}>;
  planes: Array<{id: string; source: RoofPlaneSource; pitchRise: number; azimuthDegrees: number; slopedSqft: number; solarSqft: number | null}>;
};

export const WASTE_PERCENTS = [0, 5, 10, 12, 15, 17, 20] as const;

export function suggestWastePercent(lengths: Record<RoofEdgeKind, number>) {
  const cutLines = lengths.hip + lengths.valley;
  const perimeter = lengths.eave + lengths.rake + cutLines;
  if (perimeter <= 0 || cutLines <= 0) return 10;
  return cutLines / perimeter > 0.25 ? 15 : 12;
}

export function buildRoofMeasurementReport(origin: LatLng, planes: RoofPlane[], edges: RoofEdge[]): RoofMeasurementReport {
  const rows = planes
    .filter((plane) => plane.vertices.length >= 3)
    .map((plane) => ({
      id: plane.id,
      source: plane.source,
      pitchRise: roundedPitchRise(plane.pitchDegrees),
      azimuthDegrees: Math.round(plane.azimuthDegrees),
      slopedSqft: slopedAreaSqft(origin, plane),
      planSqft: planAreaSqft(origin, plane.vertices),
      solarSqft: plane.solarSlopedAreaSqft,
    }));
  const totalSloped = rows.reduce((sum, row) => sum + row.slopedSqft, 0);
  const byPitch = new Map<number, number>();
  rows.forEach((row) => byPitch.set(row.pitchRise, (byPitch.get(row.pitchRise) ?? 0) + row.slopedSqft));
  const pitchBreakdown = [...byPitch.entries()]
    .map(([pitchRise, sqft]) => ({pitchRise, sqft, share: totalSloped > 0 ? sqft / totalSloped : 0}))
    .sort((a, b) => a.pitchRise - b.pitchRise);
  const predominant = pitchBreakdown.reduce<{pitchRise: number; sqft: number} | null>(
    (best, row) => (!best || row.sqft > best.sqft ? row : best),
    null,
  );
  const lengthsFt = Object.fromEntries(roofEdgeKinds.map((kind) => [kind, 0])) as Record<RoofEdgeKind, number>;
  edges.forEach((edge) => {
    lengthsFt[edge.kind] += edge.trueLengthFt;
  });
  const squares = totalSloped / 100;
  return {
    planeCount: rows.length,
    editedPlaneCount: rows.filter((row) => row.source !== "solar").length,
    totalSlopedSqft: totalSloped,
    totalPlanSqft: rows.reduce((sum, row) => sum + row.planSqft, 0),
    squares,
    predominantPitchRise: predominant?.pitchRise ?? null,
    pitchBreakdown,
    lengthsFt,
    reviewEdgeCount: edges.filter((edge) => edge.needsReview).length,
    suggestedWastePercent: suggestWastePercent(lengthsFt),
    wasteTable: WASTE_PERCENTS.map((percent) => {
      const withWaste = squares * (1 + percent / 100);
      return {percent, squares: withWaste, bundles: Math.ceil(withWaste * 3 - 1e-9)};
    }),
    planes: rows.map((row) => ({
      id: row.id,
      source: row.source,
      pitchRise: row.pitchRise,
      azimuthDegrees: row.azimuthDegrees,
      slopedSqft: row.slopedSqft,
      solarSqft: row.solarSqft,
    })),
  };
}

export type ActiveSquaresTier = "measured" | "drawn" | "solar";

/**
 * Which tier prices the roof: a typed measured report wins, then the drawing
 * once anyone has changed it, then Solar's blended squares.
 */
export function pickActiveSquares(input: {
  solar: SolarSquaresTier | null;
  drawn: RoofMeasurementReport | null;
  measured: MeasuredReportInput | null;
}): {tier: ActiveSquaresTier; squares: number} | null {
  if (input.measured?.totalSqft && input.measured.totalSqft > 0) {
    return {tier: "measured", squares: input.measured.totalSqft / 100};
  }
  if (input.drawn && input.drawn.planeCount > 0 && (input.drawn.editedPlaneCount > 0 || !input.solar)) {
    return {tier: "drawn", squares: input.drawn.squares};
  }
  if (input.solar) return {tier: "solar", squares: input.solar.blendedSquares};
  return null;
}

export function percentDifference(value: number, reference: number) {
  return reference > 0 ? ((value - reference) / reference) * 100 : null;
}
