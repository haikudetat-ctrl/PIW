import {
  degreesFromPitchRise,
  distanceMeters,
  guessAzimuthForDrawnPlane,
  snapToNearbyVertex,
  type LatLng,
  type RoofEdgeKind,
  type RoofPlane,
} from "@/domain/roof-drawing";

export type MeasureMode = "edit" | "draw";

export type DrawingSnapshot = {
  planes: RoofPlane[];
  overrides: Record<string, RoofEdgeKind>;
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
};

export type MeasureAction =
  | {type: "load"; origin: LatLng; planes: RoofPlane[]}
  | {type: "selectPlane"; planeId: string | null}
  | {type: "selectEdge"; edgeId: string | null}
  | {type: "moveVertex"; planeId: string; index: number; to: LatLng; snap: boolean}
  | {type: "insertVertex"; planeId: string; afterIndex: number; at: LatLng}
  | {type: "deleteVertex"; planeId: string; index: number}
  | {type: "deletePlane"; planeId: string}
  | {type: "setPitchRise"; planeId: string; rise: number}
  | {type: "setAzimuth"; planeId: string; azimuthDegrees: number}
  | {type: "setEdgeKind"; edgeId: string; kind: RoofEdgeKind | null}
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
  solarPlanes: [],
  selectedPlaneId: null,
  selectedEdgeId: null,
  mode: "edit",
  draft: [],
  history: [],
  nextDrawnId: 1,
};

const HISTORY_LIMIT = 50;
const DEFAULT_DRAWN_PITCH_RISE = 6;
const DUPLICATE_POINT_M = 0.2;

function remember(state: MeasureState): DrawingSnapshot[] {
  return [...state.history, {planes: state.planes, overrides: state.overrides}].slice(-HISTORY_LIMIT);
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
  return {...state, planes, history: remember(state)};
}

const adjusted = (plane: RoofPlane): RoofPlane["source"] => (plane.source === "solar" ? "adjusted" : plane.source);

export function measureReducer(state: MeasureState, action: MeasureAction): MeasureState {
  switch (action.type) {
    case "load":
      return {...initialMeasureState, origin: action.origin, planes: action.planes, solarPlanes: action.planes};
    case "selectPlane":
      return {...state, selectedPlaneId: action.planeId, selectedEdgeId: null};
    case "selectEdge":
      return {...state, selectedEdgeId: action.edgeId};
    case "moveVertex": {
      const origin = state.origin;
      return editPlane(state, action.planeId, (plane) => {
        const to = action.snap && origin ? snapToNearbyVertex(origin, action.to, state.planes, plane.id) : action.to;
        const vertices = plane.vertices.map((vertex, index) => (index === action.index ? to : vertex));
        return {...plane, vertices, source: adjusted(plane)};
      });
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
    case "addDraftPoint": {
      if (state.mode !== "draw") return state;
      const origin = state.origin;
      const at = origin ? snapToNearbyVertex(origin, action.at, state.planes, "") : action.at;
      return {...state, draft: [...state.draft, at]};
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
      return {...state, mode: "edit", draft: []};
    case "resetToSolar":
      return {...state, planes: state.solarPlanes, overrides: {}, history: remember(state), selectedPlaneId: null, selectedEdgeId: null};
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {...state, ...previous, history: state.history.slice(0, -1)};
    }
  }
}
