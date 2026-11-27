import {
  buildingAxisDegrees,
  degreesFromPitchRise,
  distanceMeters,
  edgeBearings,
  guessAzimuthForDrawnPlane,
  mergePlanes,
  orthoSnapCorner,
  snapToNearbyVertex,
  splitPlane,
  squareUpPlane,
  type EdgePairMode,
  type LatLng,
  type RoofEdgeKind,
  type RoofPlane,
  type RoofSurface,
} from "@/domain/roof-drawing";
import {carrySharedCorners, resizePlaneSide, translatePlane, type PlaneEditResult} from "@/domain/roof-plane-edit";

export type MeasureMode = "edit" | "draw" | "cut";

export type DrawingSnapshot = {
  planes: RoofPlane[];
  overrides: Record<string, RoofEdgeKind>;
  pairModes: Record<string, EdgePairMode>;
};

export type MeasureState = DrawingSnapshot & {
  origin: LatLng | null;
  solarPlanes: RoofPlane[];
  selectedPlaneId: string | null;
  selectedEdgeId: string | null;
  mode: MeasureMode;
  draft: LatLng[];
  history: DrawingSnapshot[];
  nextDrawnId: number;
  /** Building axis for 90-degree helpers, from the Solar planes at load. */
  axisDegrees: number | null;
  /** Why the last cut or merge was refused, shown until the next edit. */
  notice: string | null;
};

export type MeasureAction =
  | {type: "load"; origin: LatLng; planes: RoofPlane[]; saved?: DrawingSnapshot}
  | {type: "selectPlane"; planeId: string | null}
  | {type: "selectEdge"; edgeId: string | null}
  | {type: "moveVertex"; planeId: string; index: number; to: LatLng; snap: boolean}
  | {type: "squareUp"; planeId: string}
  /** Exact along-the-roof length for side `sideIndex` (corner i to i+1), keeping one end fixed. */
  | {type: "setSideLength"; planeId: string; sideIndex: number; trueLengthFt: number; keep: "start" | "end"}
  /** Move a whole plane by metres east and north; carry=false leaves joined neighbours behind. */
  | {type: "movePlane"; planeId: string; east: number; north: number; carry: boolean}
  | {type: "setSurface"; planeId: string; surface: RoofSurface}
  | {type: "setPairMode"; pairKey: string; mode: EdgePairMode | null}
  | {type: "insertVertex"; planeId: string; afterIndex: number; at: LatLng}
  | {type: "deleteVertex"; planeId: string; index: number}
  | {type: "deletePlane"; planeId: string}
  | {type: "setPitchRise"; planeId: string; rise: number}
  | {type: "setAzimuth"; planeId: string; azimuthDegrees: number}
  | {type: "setEdgeKind"; edgeId: string; kind: RoofEdgeKind | null}
  | {type: "startCut"}
  | {type: "mergePlanes"; firstId: string; secondId: string}
  | {type: "startDraw"}
  | {type: "addDraftPoint"; at: LatLng}
  | {type: "finishDraw"}
  | {type: "cancelDraw"}
  | {type: "resetToSolar"}
  | {type: "undo"};

export const initialMeasureState: MeasureState = {
  origin: null,
  planes: [],
  overrides: {},
  pairModes: {},
  solarPlanes: [],
  selectedPlaneId: null,
  selectedEdgeId: null,
  mode: "edit",
  draft: [],
  history: [],
  nextDrawnId: 1,
  axisDegrees: null,
  notice: null,
};

const HISTORY_LIMIT = 50;
const DEFAULT_DRAWN_PITCH_RISE = 6;
const DUPLICATE_POINT_M = 0.2;

function remember(state: MeasureState): DrawingSnapshot[] {
  return [...state.history, {planes: state.planes, overrides: state.overrides, pairModes: state.pairModes}].slice(-HISTORY_LIMIT);
}

function editPlane(state: MeasureState, planeId: string, change: (plane: RoofPlane) => RoofPlane | null): MeasureState {
  let changed = false;
  const planes = state.planes.flatMap((plane) => {
    if (plane.id !== planeId) return [plane];
    changed = true;
    const next = change(plane);
    return next ? [next] : [];
  });
  if (!changed) return state;
  return {...state, planes, history: remember(state), notice: null};
}

function uniqueId(taken: Set<string>, wanted: string, fallback: () => string) {
  if (wanted.length <= 40 && !taken.has(wanted)) return wanted;
  let id = fallback();
  while (taken.has(id)) id = `${id}x`;
  return id;
}

const adjusted = (plane: RoofPlane): RoofPlane["source"] => (plane.source === "solar" ? "adjusted" : plane.source);

export function measureReducer(state: MeasureState, action: MeasureAction): MeasureState {
  switch (action.type) {
    case "load": {
      const planes = action.saved?.planes ?? action.planes;
      const drawnIds = planes.map((plane) => Number(plane.id.match(/^drawn-(\d+)$/)?.[1] ?? 0));
      return {
        ...initialMeasureState,
        origin: action.origin,
        planes,
        overrides: action.saved?.overrides ?? {},
        pairModes: action.saved?.pairModes ?? {},
        solarPlanes: action.planes,
        nextDrawnId: Math.max(0, ...drawnIds) + 1,
        axisDegrees: buildingAxisDegrees(action.origin, action.planes.length ? action.planes : planes),
      };
    }
    case "selectPlane":
      return {...state, selectedPlaneId: action.planeId, selectedEdgeId: null, notice: null};
    case "selectEdge":
      return {...state, selectedEdgeId: action.edgeId};
    case "moveVertex": {
      const origin = state.origin;
      return editPlane(state, action.planeId, (plane) => {
        const to = action.snap && origin ? snapCorner(state, origin, plane, action.index, action.to).point : action.to;
        const vertices = plane.vertices.map((vertex, index) => (index === action.index ? to : vertex));
        return {...plane, vertices, source: adjusted(plane)};
      });
    }
    case "setSideLength":
    case "movePlane": {
      const origin = state.origin;
      const plane = state.planes.find((candidate) => candidate.id === action.planeId);
      if (!origin || !plane) return state;
      const result: PlaneEditResult = action.type === "setSideLength"
        ? resizePlaneSide(origin, plane, action.sideIndex, action.trueLengthFt, action.keep)
        : translatePlane(origin, plane, {x: action.east, y: action.north});
      if (!result.ok) return {...state, notice: result.reason};
      const edited = state.planes.map((candidate) => (candidate.id === plane.id ? result.plane : candidate));
      const carry = action.type === "setSideLength" || action.carry;
      const planes = carry ? carrySharedCorners(origin, edited, plane.id, result.moves, state.pairModes) : edited;
      return {...state, planes, history: remember(state), notice: null};
    }
    case "squareUp": {
      const origin = state.origin;
      const axis = state.axisDegrees ?? (origin ? buildingAxisDegrees(origin, state.planes) : null);
      if (!origin || axis === null) return state;
      return editPlane(state, action.planeId, (plane) => squareUpPlane(origin, plane, axis));
    }
    case "setSurface":
      return editPlane(state, action.planeId, (plane) => ({...plane, surface: action.surface, source: adjusted(plane)}));
    case "setPairMode": {
      const pairModes = {...state.pairModes};
      if (action.mode === null) delete pairModes[action.pairKey];
      else pairModes[action.pairKey] = action.mode;
      return {...state, pairModes, selectedEdgeId: null, history: remember(state)};
    }
    case "insertVertex":
      return editPlane(state, action.planeId, (plane) => {
        const vertices = [...plane.vertices];
        vertices.splice(action.afterIndex + 1, 0, action.at);
        return {...plane, vertices, source: adjusted(plane)};
      });
    case "deleteVertex":
      return editPlane(state, action.planeId, (plane) => {
        if (plane.vertices.length <= 3) return plane;
        return {...plane, vertices: plane.vertices.filter((_, index) => index !== action.index), source: adjusted(plane)};
      });
    case "deletePlane": {
      const next = editPlane(state, action.planeId, () => null);
      return next === state ? state : {...next, selectedPlaneId: null, selectedEdgeId: null};
    }
    case "setPitchRise":
      return editPlane(state, action.planeId, (plane) => ({
        ...plane,
        pitchDegrees: degreesFromPitchRise(Math.min(Math.max(action.rise, 0), 24)),
        source: adjusted(plane),
      }));
    case "setAzimuth":
      return editPlane(state, action.planeId, (plane) => ({
        ...plane,
        azimuthDegrees: ((action.azimuthDegrees % 360) + 360) % 360,
        source: adjusted(plane),
      }));
    case "setEdgeKind": {
      const overrides = {...state.overrides};
      if (action.kind === null) delete overrides[action.edgeId];
      else overrides[action.edgeId] = action.kind;
      return {...state, overrides, history: remember(state)};
    }
    case "startDraw":
      return {...state, mode: "draw", draft: [], selectedPlaneId: null, selectedEdgeId: null};
    case "startCut":
      if (!state.selectedPlaneId) return state;
      return {...state, mode: "cut", draft: [], selectedEdgeId: null, notice: null};
    case "addDraftPoint": {
      if (state.mode === "edit") return state;
      const origin = state.origin;
      const at = origin ? snapToNearbyVertex(origin, action.at, state.planes, "") : action.at;
      if (state.mode === "draw") return {...state, draft: [...state.draft, at]};
      // Cut mode: the second click finishes the cut line.
      if (state.draft.length === 0) return {...state, draft: [at]};
      const plane = state.planes.find((candidate) => candidate.id === state.selectedPlaneId);
      if (!origin || !plane) return {...state, mode: "edit", draft: []};
      const result = splitPlane(origin, plane, state.draft[0], at);
      if (!result.ok) return {...state, mode: "edit", draft: [], notice: result.reason};
      const taken = new Set(state.planes.map((candidate) => candidate.id));
      let nextDrawnId = state.nextDrawnId;
      const halves = result.planes.map((half) => {
        const id = uniqueId(taken, half.id, () => `drawn-${nextDrawnId++}`);
        taken.add(id);
        return {...half, id};
      });
      const index = state.planes.indexOf(plane);
      const planes = [...state.planes.slice(0, index), ...halves, ...state.planes.slice(index + 1)];
      return {...state, planes, history: remember(state), mode: "edit", draft: [], selectedPlaneId: halves[0].id, nextDrawnId, notice: null};
    }
    case "mergePlanes": {
      const first = state.planes.find((plane) => plane.id === action.firstId);
      const second = state.planes.find((plane) => plane.id === action.secondId);
      if (!state.origin || !first || !second || first === second) return state;
      const result = mergePlanes(state.origin, first, second);
      if (!result.ok) return {...state, notice: result.reason};
      const [merged] = result.planes;
      const planes = state.planes.flatMap((plane) => {
        if (plane === first || plane === second) return plane.id === merged.id ? [merged] : [];
        return [plane];
      });
      return {...state, planes, history: remember(state), selectedPlaneId: merged.id, selectedEdgeId: null, notice: null};
    }
    case "finishDraw": {
      if (state.mode !== "draw" || state.draft.length < 3 || !state.origin) {
        return {...state, mode: "edit", draft: []};
      }
      // A double-click to finish also lands two clicks on the same spot.
      const points = state.draft.filter((point, index) =>
        index === 0 || distanceMeters(state.draft[index - 1], point) > DUPLICATE_POINT_M);
      if (points.length < 3) return {...state, mode: "edit", draft: []};
      const id = `drawn-${state.nextDrawnId}`;
      const plane: RoofPlane = {
        id,
        vertices: points,
        pitchDegrees: degreesFromPitchRise(DEFAULT_DRAWN_PITCH_RISE),
        azimuthDegrees: guessAzimuthForDrawnPlane(state.origin, points),
        source: "drawn",
        solarSlopedAreaSqft: null,
      };
      return {
        ...state,
        planes: [...state.planes, plane],
        history: remember(state),
        mode: "edit",
        draft: [],
        selectedPlaneId: id,
        nextDrawnId: state.nextDrawnId + 1,
      };
    }
    case "cancelDraw":
      return {...state, mode: "edit", draft: [], notice: null};
    case "resetToSolar":
      return {...state, planes: state.solarPlanes, overrides: {}, pairModes: {}, history: remember(state), selectedPlaneId: null, selectedEdgeId: null};
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {...state, ...previous, history: state.history.slice(0, -1)};
    }
  }
}

/**
 * Where a dragged corner lands: onto another plane's corner when close,
 * otherwise square to the building axes or parallel to another edge.
 */
export function snapCorner(state: MeasureState, origin: LatLng, plane: RoofPlane, index: number, to: LatLng) {
  const corner = snapToNearbyVertex(origin, to, state.planes, plane.id);
  if (corner !== to) return {point: corner, snapped: true, kind: "corner" as const};
  const n = plane.vertices.length;
  const others = state.planes.filter((other) => other.id !== plane.id);
  const ortho = orthoSnapCorner({
    origin,
    previous: plane.vertices[(index - 1 + n) % n],
    next: plane.vertices[(index + 1) % n],
    proposed: to,
    axisDegrees: state.axisDegrees,
    extraBearings: edgeBearings(origin, others),
  });
  return {point: ortho.point, snapped: ortho.snapped, kind: ortho.snapped ? "square" as const : null};
}
