import {
  FT_PER_M,
  ORTHO_SNAP_DEGREES,
  planePairKey,
  toLatLng,
  toLocal,
  type EdgePairMode,
  type LatLng,
  type RoofPlane,
} from "./roof-drawing";

// Exact-length sides and whole-plane moves for the roof measuring page.
//
// Shared edges: corners of other planes that sit on a moved corner (within
// GLUE_TOLERANCE_M) move with it, unless the two planes are split at that
// meeting. So a joined ridge or valley stays one edge; a neighbour stretches
// to follow. Pass carry=false to move a plane alone.

const DEG = Math.PI / 180;
export const GLUE_TOLERANCE_M = 0.15;
const MIN_SIDE_M = 0.3;

type Local = {x: number; y: number};
type Move = {from: LatLng; to: LatLng};

const sub = (a: Local, b: Local): Local => ({x: a.x - b.x, y: a.y - b.y});
const add = (a: Local, b: Local): Local => ({x: a.x + b.x, y: a.y + b.y});
const scale = (a: Local, k: number): Local => ({x: a.x * k, y: a.y * k});
const length = (a: Local) => Math.hypot(a.x, a.y);

/** Along-the-roof length over plan length for a run in direction `unit` across a plane. */
function slopeFactor(plane: Pick<RoofPlane, "pitchDegrees" | "azimuthDegrees">, unit: Local) {
  const down = {x: Math.sin(plane.azimuthDegrees * DEG), y: Math.cos(plane.azimuthDegrees * DEG)};
  const slope = Math.tan(Math.min(plane.pitchDegrees, 80) * DEG) * (unit.x * down.x + unit.y * down.y);
  return Math.sqrt(1 + slope * slope);
}

export type PlaneSide = {
  index: number;
  /** Corner letters, A for vertex 0. */
  label: string;
  start: LatLng;
  end: LatLng;
  planLengthFt: number;
  trueLengthFt: number;
  /** Compass direction the side faces outward from the plane, e.g. "S". */
  faces: string;
};

export const cornerLetter = (index: number) =>
  index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(65 + Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function signedArea(points: Local[]) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function planeSides(origin: LatLng, plane: RoofPlane): PlaneSide[] {
  const points = plane.vertices.map((vertex) => toLocal(origin, vertex));
  const counterClockwise = signedArea(points) > 0;
  return points.map((a, index) => {
    const nextIndex = (index + 1) % points.length;
    const run = sub(points[nextIndex], a);
    const plan = length(run);
    const unit = plan > 0 ? scale(run, 1 / plan) : {x: 1, y: 0};
    // Outward normal: right of the run for a counter-clockwise ring.
    const outward = counterClockwise ? {x: unit.y, y: -unit.x} : {x: -unit.y, y: unit.x};
    const bearing = ((Math.atan2(outward.x, outward.y) / DEG) + 360) % 360;
    return {
      index,
      label: `${cornerLetter(index)}–${cornerLetter(nextIndex)}`,
      start: plane.vertices[index],
      end: plane.vertices[nextIndex],
      planLengthFt: plan * FT_PER_M,
      trueLengthFt: plan * slopeFactor(plane, unit) * FT_PER_M,
      faces: COMPASS[Math.round(bearing / 45) % 8],
    };
  });
}

const isSquare = (a: Local, b: Local) => {
  const cos = Math.abs(a.x * b.x + a.y * b.y) / (length(a) * length(b) || 1);
  return cos < Math.sin(ORTHO_SNAP_DEGREES * DEG);
};

export type PlaneEditResult = {ok: true; plane: RoofPlane; moves: Move[]} | {ok: false; reason: string};

/**
 * Sets a side to an exact along-the-roof length, keeping one end where it is.
 * The other end slides along the side. Where the far corner is square (the
 * next side runs at 90 degrees, within the 90-degree helper's tolerance), that
 * whole next side slides with it, so a rectangle stays a rectangle.
 */
export function resizePlaneSide(
  origin: LatLng,
  plane: RoofPlane,
  sideIndex: number,
  trueLengthFt: number,
  keep: "start" | "end",
): PlaneEditResult {
  const n = plane.vertices.length;
  if (sideIndex < 0 || sideIndex >= n) return {ok: false, reason: "That side is not on this plane."};
  if (!Number.isFinite(trueLengthFt) || trueLengthFt <= 0) return {ok: false, reason: "Enter a length in feet."};
  const points = plane.vertices.map((vertex) => toLocal(origin, vertex));
  const fixedIndex = keep === "start" ? sideIndex : (sideIndex + 1) % n;
  const movingIndex = keep === "start" ? (sideIndex + 1) % n : sideIndex;
  // The corner past the moving end, along the next side away from the fixed end.
  const beyondIndex = keep === "start" ? (movingIndex + 1) % n : (movingIndex - 1 + n) % n;
  const run = sub(points[movingIndex], points[fixedIndex]);
  const plan = length(run);
  if (plan === 0) return {ok: false, reason: "That side has no length to scale."};
  const unit = scale(run, 1 / plan);
  const newPlan = trueLengthFt / FT_PER_M / slopeFactor(plane, unit);
  if (newPlan < MIN_SIDE_M) return {ok: false, reason: "That is shorter than a foot; draw the plane again instead."};
  const shift = scale(unit, newPlan - plan);
  const toMove = [movingIndex];
  if (n >= 4 && beyondIndex !== fixedIndex && isSquare(run, sub(points[beyondIndex], points[movingIndex]))) toMove.push(beyondIndex);
  const moves: Move[] = [];
  const next = points.map((point, index) => {
    if (!toMove.includes(index)) return plane.vertices[index];
    const moved = toLatLng(origin, add(point, shift));
    moves.push({from: plane.vertices[index], to: moved});
    return moved;
  });
  return {ok: true, plane: {...plane, vertices: next, source: plane.source === "solar" ? "adjusted" : plane.source}, moves};
}

/** Moves a whole plane by an offset in metres (east, north). */
export function translatePlane(origin: LatLng, plane: RoofPlane, offset: Local): PlaneEditResult {
  const moves: Move[] = [];
  const vertices = plane.vertices.map((vertex) => {
    const moved = toLatLng(origin, add(toLocal(origin, vertex), offset));
    moves.push({from: vertex, to: moved});
    return moved;
  });
  const heightRef = plane.heightRef ? {...plane.heightRef, at: toLatLng(origin, add(toLocal(origin, plane.heightRef.at), offset))} : plane.heightRef;
  return {ok: true, plane: {...plane, vertices, heightRef, source: plane.source === "solar" ? "adjusted" : plane.source}, moves};
}

/**
 * Moves corners of other planes that sat on a moved corner, so shared edges
 * stay shared. Planes split from the edited plane are left alone.
 */
export function carrySharedCorners(
  origin: LatLng,
  planes: RoofPlane[],
  editedId: string,
  moves: Move[],
  pairModes: Record<string, EdgePairMode>,
): RoofPlane[] {
  if (moves.length === 0) return planes;
  const from = moves.map((move) => ({local: toLocal(origin, move.from), to: move.to}));
  return planes.map((plane) => {
    if (plane.id === editedId || pairModes[planePairKey(plane.id, editedId)] === "split") return plane;
    let changed = false;
    const vertices = plane.vertices.map((vertex) => {
      const local = toLocal(origin, vertex);
      const hit = from.find((move) => length(sub(move.local, local)) <= GLUE_TOLERANCE_M);
      if (!hit) return vertex;
      changed = true;
      return hit.to;
    });
    return changed ? {...plane, vertices, source: plane.source === "solar" ? "adjusted" : plane.source} : plane;
  });
}
