// Roof drawing model for the staff roof measuring page (/roof-measure). Pure
// geometry: no network, no database, and nothing here feeds the live customer
// price path.
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
  /**
   * "wall" marks a face that is not roofing (a dormer cheek or front wall):
   * left out of area, squares and waste, and its edges against roof planes
   * become flashing. Absent means roof.
   */
  surface?: RoofSurface;
  /**
   * A known height on the plane (Solar's plane height at its segment centre,
   * metres above sea level). With pitch and facing it gives the plane's height
   * anywhere, so planes at different levels are not joined. Null when drawn.
   */
  heightRef?: {at: LatLng; meters: number} | null;
};

export type RoofSurface = "roof" | "wall";

export const isWall = (plane: Pick<RoofPlane, "surface">) => plane.surface === "wall";

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
  /**
   * Set where this edge lies along another plane. joined: one shared edge,
   * counted once. Not joined: each plane keeps its own edge (an eave dripping
   * onto a lower roof, step flashing on the lower side), both counted.
   */
  pair: {key: string; otherPlaneId: string; joined: boolean} | null;
};

export type EdgePairMode = "join" | "split";

/** Stable key for the meeting of two planes, independent of order. */
export const planePairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

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
    surface: "roof",
    heightRef: segment.planeHeightAtCenterMeters === null
      ? null
      : {at: segment.center, meters: segment.planeHeightAtCenterMeters},
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
  heightRef: {at: LocalPoint; meters: number} | null;
};

type Piece = {
  planeIds: [string] | [string, string];
  a: LocalPoint;
  b: LocalPoint;
  key: string;
  /** For an open piece: it sits against a plane that is clearly higher here. */
  againstHigherPlane: boolean;
  pair: RoofEdge["pair"];
};

/** Planes whose heights differ by more than this at a shared line are on different levels. */
export const LEVEL_GAP_M = 1.0;

function localPlanes(origin: LatLng, planes: RoofPlane[]): LocalPlane[] {
  return planes
    .filter((plane) => plane.vertices.length >= 3)
    .map((plane) => {
      const points = plane.vertices.map((v) => toLocal(origin, v));
      return {
        plane,
        points,
        center: centroid(points),
        down: downslope(plane.azimuthDegrees),
        heightRef: plane.heightRef ? {at: toLocal(origin, plane.heightRef.at), meters: plane.heightRef.meters} : null,
      };
    });
}

function heightAt(plane: LocalPlane, point: LocalPoint): number | null {
  if (!plane.heightRef || isWall(plane.plane)) return null;
  const run = (point.x - plane.heightRef.at.x) * plane.down.x + (point.y - plane.heightRef.at.y) * plane.down.y;
  return plane.heightRef.meters - Math.tan(Math.min(plane.plane.pitchDegrees, 80) * DEG) * run;
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

function splitEdges(planes: LocalPlane[], pairModes: Record<string, EdgePairMode>): Piece[] {
  const pieces: Piece[] = [];
  planes.forEach((self) => {
    edgesOf(self.points).forEach(({a, b, index}) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < MIN_PIECE_M) return;
      const u = {x: (b.x - a.x) / length, y: (b.y - a.y) / length};
      const at = (t: number): LocalPoint => ({x: a.x + u.x * t, y: a.y + u.y * t});
      const shared: Array<{lo: number; hi: number; other: string}> = [];
      const neighbors: Array<{lo: number; hi: number; other: string; otherHigher: boolean}> = [];
      planes.forEach((other) => {
        if (other.plane.id === self.plane.id) return;
        if (isWall(self.plane) && isWall(other.plane)) return;
        edgesOf(other.points).forEach((edge) => {
          const interval = overlapInterval(a, b, edge.a, edge.b);
          if (!interval) return;
          const mid = at((interval[0] + interval[1]) / 2);
          const mine = heightAt(self, mid);
          const theirs = heightAt(other, mid);
          const levelsDiffer = mine !== null && theirs !== null && Math.abs(mine - theirs) > LEVEL_GAP_M;
          const mode = pairModes[planePairKey(self.plane.id, other.plane.id)] ?? (levelsDiffer ? "split" : "join");
          if (mode === "split" && !isWall(self.plane) && !isWall(other.plane)) {
            // Different levels (for example a pent roof under a second-story
            // wall), or split by hand: each plane keeps its own edge. Without
            // heights, a split on this plane's top side means the other is above.
            const otherHigher = mine !== null && theirs !== null
              ? theirs > mine
              : (mid.x - self.center.x) * self.down.x + (mid.y - self.center.y) * self.down.y < 0;
            neighbors.push({lo: interval[0], hi: interval[1], other: other.plane.id, otherHigher});
            return;
          }
          shared.push({lo: interval[0], hi: interval[1], other: other.plane.id});
        });
      });
      shared.sort((x, y) => x.lo - y.lo);
      let cursor = 0;
      let freeIndex = 0;
      const pushFree = (lo: number, hi: number) => {
        if (hi - lo < MIN_PIECE_M) return;
        // Wall faces only contribute where they meet roof.
        if (isWall(self.plane)) return;
        const middle = (lo + hi) / 2;
        const neighbor = neighbors.find((item) => item.lo <= middle && middle <= item.hi);
        pieces.push({
          planeIds: [self.plane.id],
          a: at(lo),
          b: at(hi),
          key: `${self.plane.id}:${index}:${freeIndex}`,
          againstHigherPlane: neighbor?.otherHigher ?? false,
          pair: neighbor ? {key: planePairKey(self.plane.id, neighbor.other), otherPlaneId: neighbor.other, joined: false} : null,
        });
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
            againstHigherPlane: false,
            pair: {key: planePairKey(self.plane.id, item.other), otherPlaneId: item.other, joined: true},
          });
        }
        cursor = Math.max(cursor, item.hi);
      });
      if (cursor < length) pushFree(cursor, length);
    });
  });
  return pieces;
}

type SideInfo = {
  /** Height change per metre moving from the edge into the plane (negative: falls away). */
  riseInto: number;
  high: boolean;
  low: boolean;
  alongSlope: number;
  flat: boolean;
  wall: boolean;
  down: LocalPoint;
};

function sideOf(plane: LocalPlane, mid: LocalPoint, u: LocalPoint): SideInfo {
  const offset = (mid.x - plane.center.x) * plane.down.x + (mid.y - plane.center.y) * plane.down.y;
  const alongSlope = Math.abs(u.x * plane.down.x + u.y * plane.down.y);
  // Unit normal to the edge, pointing into this plane.
  let n = {x: -u.y, y: u.x};
  if ((plane.center.x - mid.x) * n.x + (plane.center.y - mid.y) * n.y < 0) n = {x: -n.x, y: -n.y};
  const riseInto = -Math.tan(Math.min(plane.plane.pitchDegrees, 80) * DEG) * (n.x * plane.down.x + n.y * plane.down.y);
  return {
    riseInto,
    high: offset < -0.05,
    low: offset > 0.05,
    alongSlope,
    flat: plane.plane.pitchDegrees < FLAT_PITCH_DEG,
    wall: isWall(plane.plane),
    down: plane.down,
  };
}

/** Dihedral strength below which a shared edge's convex/concave call is a coin toss. */
const FOLD_CONFIDENCE = 0.08;

function classify(pieceSides: SideInfo[], againstHigherPlane: boolean): {kind: RoofEdgeKind; needsReview: boolean} {
  if (pieceSides.length === 1) {
    const [s] = pieceSides;
    if (s.flat) return {kind: againstHigherPlane && s.high ? "wall_flashing" : "eave", needsReview: false};
    if (s.alongSlope > 0.5) {
      return againstHigherPlane ? {kind: "step_flashing", needsReview: false} : {kind: "rake", needsReview: false};
    }
    if (s.low) return {kind: "eave", needsReview: false};
    // A top edge under a higher plane is a headwall. Otherwise it is either a
    // ridge whose other side was never drawn or a wall: worth a look.
    if (againstHigherPlane) return {kind: "wall_flashing", needsReview: false};
    return {kind: "ridge", needsReview: true};
  }
  const [a, b] = pieceSides;
  if (a.wall || b.wall) {
    const roof = a.wall ? b : a;
    // Roof against a wall face: up the slope is step flashing, across it a
    // headwall or apron.
    return {kind: roof.alongSlope > 0.5 ? "step_flashing" : "wall_flashing", needsReview: false};
  }
  const contour = a.alongSlope < 0.35 && b.alongSlope < 0.35;
  const sameFacing = a.down.x * b.down.x + a.down.y * b.down.y > 0.7;
  if (contour && sameFacing) return {kind: "transition", needsReview: false};
  // Convex fold (both planes fall away from the edge) is a ridge or hip;
  // concave (both rise away) is a valley. Summing the two rises keeps a
  // nearly level reading on one plane from deciding on its own.
  const fold = a.riseInto + b.riseInto;
  const needsReview = Math.abs(fold) < FOLD_CONFIDENCE;
  if (fold < 0) return {kind: contour ? "ridge" : "hip", needsReview};
  return {kind: "valley", needsReview};
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
  pairModes: Record<string, EdgePairMode> = {},
): RoofEdge[] {
  const locals = localPlanes(origin, planes);
  const byId = new Map(locals.map((p) => [p.plane.id, p]));
  return splitEdges(locals, pairModes).map((piece) => {
    const length = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y);
    const u = {x: (piece.b.x - piece.a.x) / length, y: (piece.b.y - piece.a.y) / length};
    const mid = {x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2};
    const owners = piece.planeIds.map((id) => byId.get(id) as LocalPlane);
    const auto = classify(owners.map((owner) => sideOf(owner, mid, u)), piece.againstHigherPlane);
    // Flashing and lengths follow the roof plane, not the wall face.
    const roofOwners = owners.filter((owner) => !isWall(owner.plane));
    const override = overrides[piece.key];
    return {
      id: piece.key,
      planeIds: piece.planeIds,
      start: toLatLng(origin, piece.a),
      end: toLatLng(origin, piece.b),
      planLengthFt: length * FT_PER_M,
      trueLengthFt: trueLength(length, u, roofOwners.length ? roofOwners : owners) * FT_PER_M,
      kind: override ?? auto.kind,
      autoKind: auto.kind,
      overridden: override !== undefined && override !== auto.kind,
      needsReview: override === undefined && auto.needsReview,
      pair: piece.pair,
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
  /** Roof area steeper than the rate card's 10/12 line (steep charge). */
  steepSqft: number;
  /** Faces marked as not roof, left out of every total above. */
  wallPlaneCount: number;
  wallSqft: number;
  /** Roof planes steep enough that they may really be wall faces; a suggestion only. */
  possibleWallPlaneIds: string[];
  planes: Array<{id: string; source: RoofPlaneSource; surface: RoofSurface; pitchRise: number; azimuthDegrees: number; slopedSqft: number; solarSqft: number | null}>;
};

/** Rate card line above which work is priced as steep. */
export const STEEP_PITCH_RISE = 10;
/** Steeper than this, a plane may be a wall face rather than roof. */
export const POSSIBLE_WALL_PITCH_RISE = 14;

export const WASTE_PERCENTS = [0, 5, 10, 12, 15, 17, 20] as const;

export function suggestWastePercent(lengths: Record<RoofEdgeKind, number>) {
  const cutLines = lengths.hip + lengths.valley;
  const perimeter = lengths.eave + lengths.rake + cutLines;
  if (perimeter <= 0 || cutLines <= 0) return 10;
  return cutLines / perimeter > 0.25 ? 15 : 12;
}

export function buildRoofMeasurementReport(origin: LatLng, planes: RoofPlane[], edges: RoofEdge[]): RoofMeasurementReport {
  const allRows = planes
    .filter((plane) => plane.vertices.length >= 3)
    .map((plane) => ({
      id: plane.id,
      source: plane.source,
      surface: (plane.surface ?? "roof") as RoofSurface,
      rise: pitchRiseFromDegrees(plane.pitchDegrees),
      pitchRise: roundedPitchRise(plane.pitchDegrees),
      azimuthDegrees: Math.round(plane.azimuthDegrees),
      slopedSqft: slopedAreaSqft(origin, plane),
      planSqft: planAreaSqft(origin, plane.vertices),
      solarSqft: plane.solarSlopedAreaSqft,
    }));
  const rows = allRows.filter((row) => row.surface === "roof");
  const walls = allRows.filter((row) => row.surface === "wall");
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
    editedPlaneCount: allRows.filter((row) => row.source !== "solar").length,
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
    steepSqft: rows.filter((row) => row.rise > STEEP_PITCH_RISE).reduce((sum, row) => sum + row.slopedSqft, 0),
    wallPlaneCount: walls.length,
    wallSqft: walls.reduce((sum, row) => sum + row.slopedSqft, 0),
    possibleWallPlaneIds: rows.filter((row) => row.rise > POSSIBLE_WALL_PITCH_RISE).map((row) => row.id),
    planes: allRows.map((row) => ({
      id: row.id,
      source: row.source,
      surface: row.surface,
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

// ---------------------------------------------------------------------------
// 90-degree helpers

/** Corners and edges within this many degrees of the building's axes snap square. */
export const ORTHO_SNAP_DEGREES = 8;
/** Edges further off-axis than this are left alone by "square up". */
const SQUARE_UP_MAX_DEGREES = 20;

/**
 * The building's main axis in degrees (0 to 90): the area-weighted average of
 * plane facings folded onto a quarter turn, so north, east, south and west
 * facings of a square-built house agree.
 */
export function buildingAxisDegrees(origin: LatLng, planes: RoofPlane[]): number | null {
  let x = 0;
  let y = 0;
  planes.forEach((plane) => {
    const weight = planAreaSqft(origin, plane.vertices);
    const angle = 4 * plane.azimuthDegrees * DEG;
    x += weight * Math.cos(angle);
    y += weight * Math.sin(angle);
  });
  if (Math.hypot(x, y) < 1e-6) return null;
  return ((Math.atan2(y, x) / DEG / 4) % 90 + 90) % 90;
}

/** Compass bearing of the line from a to b, folded to 0-180. */
function lineBearing(a: LocalPoint, b: LocalPoint) {
  return ((Math.atan2(b.x - a.x, b.y - a.y) / DEG) % 180 + 180) % 180;
}

function angleGap(a: number, b: number) {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function unitFromBearing(bearing: number): LocalPoint {
  return {x: Math.sin(bearing * DEG), y: Math.cos(bearing * DEG)};
}

function projectOntoLine(point: LocalPoint, through: LocalPoint, dir: LocalPoint): LocalPoint {
  const t = (point.x - through.x) * dir.x + (point.y - through.y) * dir.y;
  return {x: through.x + dir.x * t, y: through.y + dir.y * t};
}

function intersectLines(p: LocalPoint, u: LocalPoint, q: LocalPoint, v: LocalPoint): LocalPoint | null {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  return {x: p.x + u.x * t, y: p.y + u.y * t};
}

/**
 * Where a dragged corner should land so the edges to its two neighbours run
 * along the building axes (or parallel to another drawn edge). Returns the
 * point unchanged and snapped false when neither edge is close.
 */
export function orthoSnapCorner(input: {
  origin: LatLng;
  previous: LatLng;
  next: LatLng;
  proposed: LatLng;
  axisDegrees: number | null;
  /** Bearings (0-180) of other drawn edges to offer as parallels. */
  extraBearings?: number[];
}): {point: LatLng; snapped: boolean} {
  const {origin} = input;
  const p = toLocal(origin, input.proposed);
  const bearings = [
    ...(input.axisDegrees === null ? [] : [input.axisDegrees % 180, (input.axisDegrees + 90) % 180]),
    ...(input.extraBearings ?? []),
  ];
  if (bearings.length === 0) return {point: input.proposed, snapped: false};
  const pick = (from: LatLng) => {
    const anchor = toLocal(origin, from);
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) < 0.3) return null;
    const bearing = lineBearing(anchor, p);
    let best: {bearing: number; gap: number} | null = null;
    bearings.forEach((candidate) => {
      const gap = angleGap(bearing, candidate);
      if (gap <= ORTHO_SNAP_DEGREES && (!best || gap < best.gap)) best = {bearing: candidate, gap};
    });
    return best ? {anchor, dir: unitFromBearing((best as {bearing: number}).bearing)} : null;
  };
  const a = pick(input.previous);
  const b = pick(input.next);
  let result: LocalPoint | null = null;
  if (a && b) result = intersectLines(a.anchor, a.dir, b.anchor, b.dir);
  if (!result && a) result = projectOntoLine(p, a.anchor, a.dir);
  if (!result && b) result = projectOntoLine(p, b.anchor, b.dir);
  if (!result || Math.hypot(result.x - p.x, result.y - p.y) > 3) return {point: input.proposed, snapped: false};
  return {point: toLatLng(origin, result), snapped: true};
}

/**
 * Squares a plane to the building axes: every edge within 20 degrees of an
 * axis is turned onto it, through its own midpoint, and corners move to where
 * the squared edges meet. Diagonal edges (hips, valleys) keep their ends.
 */
export function squareUpPlane(origin: LatLng, plane: RoofPlane, axisDegrees: number): RoofPlane {
  const points = plane.vertices.map((v) => toLocal(origin, v));
  const n = points.length;
  if (n < 3) return plane;
  const axes = [axisDegrees % 180, (axisDegrees + 90) % 180];
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % n];
    const bearing = lineBearing(a, b);
    const axis = axes.find((candidate) => angleGap(bearing, candidate) <= SQUARE_UP_MAX_DEGREES);
    return axis === undefined
      ? null
      : {through: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, dir: unitFromBearing(axis)};
  });
  const squared = points.map((point, i) => {
    const before = lines[(i - 1 + n) % n];
    const after = lines[i];
    if (before && after) {
      return intersectLines(before.through, before.dir, after.through, after.dir) ?? projectOntoLine(point, after.through, after.dir);
    }
    if (before) return projectOntoLine(point, before.through, before.dir);
    if (after) return projectOntoLine(point, after.through, after.dir);
    return point;
  });
  return {
    ...plane,
    vertices: squared.map((point) => toLatLng(origin, point)),
    source: plane.source === "solar" ? "adjusted" : plane.source,
  };
}

/** Bearings (0-180) of every edge of the given planes, for parallel snapping. */
export function edgeBearings(origin: LatLng, planes: RoofPlane[]) {
  return planes.flatMap((plane) => {
    const points = plane.vertices.map((v) => toLocal(origin, v));
    return points.map((a, i) => lineBearing(a, points[(i + 1) % points.length]));
  });
}
