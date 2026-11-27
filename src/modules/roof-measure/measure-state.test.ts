import {describe, expect, test} from "vitest";
import {pitchRiseFromDegrees, toLatLng, toLocal, type RoofPlane} from "@/domain/roof-drawing";
import {initialMeasureState, measureReducer, type MeasureAction, type MeasureState} from "./measure-state";

const origin = {lat: 40.35, lng: -74.07};
const at = (x: number, y: number) => toLatLng(origin, {x, y});
const solarPlane: RoofPlane = {
  id: "solar-1",
  vertices: [at(0, 0), at(10, 0), at(10, 4), at(0, 4)],
  pitchDegrees: 26.57,
  azimuthDegrees: 0,
  source: "solar",
  solarSlopedAreaSqft: 480,
};
const other: RoofPlane = {...solarPlane, id: "solar-2", vertices: [at(0, -4), at(10, -4), at(10, 0), at(0, 0)], azimuthDegrees: 180};

const run = (actions: MeasureAction[], start: MeasureState = initialMeasureState) => actions.reduce(measureReducer, start);
const loaded = run([{type: "load", origin, planes: [solarPlane, other]}]);

describe("measuring sandbox state", () => {
  test("moving a corner marks a Solar plane as adjusted and snaps to a neighbour's corner", () => {
    const state = run([{type: "moveVertex", planeId: "solar-1", index: 1, to: at(10.3, -3.8), snap: true}], loaded);
    const plane = state.planes[0];
    expect(plane.source).toBe("adjusted");
    const moved = toLocal(origin, plane.vertices[1]);
    expect(moved.x).toBeCloseTo(10, 6);
    expect(moved.y).toBeCloseTo(-4, 6);
  });

  test("adds and removes corners but never below three", () => {
    let state = run([{type: "insertVertex", planeId: "solar-1", afterIndex: 0, at: at(5, -0.5)}], loaded);
    expect(state.planes[0].vertices).toHaveLength(5);
    state = run([
      {type: "deleteVertex", planeId: "solar-1", index: 0},
      {type: "deleteVertex", planeId: "solar-1", index: 0},
      {type: "deleteVertex", planeId: "solar-1", index: 0},
    ], state);
    expect(state.planes[0].vertices).toHaveLength(3);
  });

  test("draws a new plane from clicks, ignoring the double-click's repeated point", () => {
    const state = run([
      {type: "startDraw"},
      {type: "addDraftPoint", at: at(20, 0)},
      {type: "addDraftPoint", at: at(26, 0)},
      {type: "addDraftPoint", at: at(26, 3)},
      {type: "addDraftPoint", at: at(26, 3.05)},
      {type: "finishDraw"},
    ], loaded);
    const drawn = state.planes.at(-1)!;
    expect(drawn.id).toBe("drawn-1");
    expect(drawn.source).toBe("drawn");
    expect(drawn.vertices).toHaveLength(3);
    expect(Math.round(pitchRiseFromDegrees(drawn.pitchDegrees))).toBe(6);
    expect(state.mode).toBe("edit");
    expect(state.selectedPlaneId).toBe("drawn-1");
  });

  test("a plane needs three corners", () => {
    const state = run([{type: "startDraw"}, {type: "addDraftPoint", at: at(20, 0)}, {type: "finishDraw"}], loaded);
    expect(state.planes).toHaveLength(2);
  });

  test("undo steps back through edits and reset restores Solar", () => {
    let state = run([
      {type: "setPitchRise", planeId: "solar-1", rise: 9},
      {type: "deletePlane", planeId: "solar-2"},
    ], loaded);
    expect(state.planes).toHaveLength(1);
    state = run([{type: "undo"}], state);
    expect(state.planes).toHaveLength(2);
    expect(pitchRiseFromDegrees(state.planes[0].pitchDegrees)).toBeCloseTo(9, 6);
    state = run([{type: "setEdgeKind", edgeId: "x", kind: "valley"}, {type: "resetToSolar"}], state);
    expect(state.planes).toEqual([solarPlane, other]);
    expect(state.overrides).toEqual({});
  });

  test("squares a plane to the building axis and marks it adjusted", () => {
    const skewed = {...solarPlane, vertices: [at(0, 0), at(10, 0.5), at(10.3, 4), at(0, 4.2)]};
    const state = run([{type: "load", origin, planes: [skewed, other]}, {type: "squareUp", planeId: "solar-1"}]);
    const pts = state.planes[0].vertices.map((v) => toLocal(origin, v));
    expect(pts[0].y).toBeCloseTo(pts[1].y, 6);
    expect(state.planes[0].source).toBe("adjusted");
  });

  test("a corner dragged near square snaps onto the building axes", () => {
    const state = run([{type: "moveVertex", planeId: "solar-1", index: 2, to: at(10.4, 4.3), snap: true}], loaded);
    const moved = toLocal(origin, state.planes[0].vertices[2]);
    expect(moved.x).toBeCloseTo(10, 6);
    expect(moved.y).toBeCloseTo(4, 6);
  });

  test("marks a face as wall, toggles a shared edge to split, and restores a saved drawing", () => {
    let state = run([
      {type: "setSurface", planeId: "solar-2", surface: "wall"},
      {type: "setPairMode", pairKey: "solar-1|solar-2", mode: "split"},
    ], loaded);
    expect(state.planes[1].surface).toBe("wall");
    expect(state.pairModes).toEqual({"solar-1|solar-2": "split"});
    const saved = {planes: state.planes, overrides: {x: "hip" as const}, pairModes: state.pairModes};
    state = run([{type: "load", origin, planes: [solarPlane, other], saved}]);
    expect(state.planes[1].surface).toBe("wall");
    expect(state.overrides).toEqual({x: "hip"});
    expect(state.solarPlanes).toEqual([solarPlane, other]);
  });

  test("clears an edge override", () => {
    const state = run([{type: "setEdgeKind", edgeId: "e", kind: "hip"}, {type: "setEdgeKind", edgeId: "e", kind: null}], loaded);
    expect(state.overrides).toEqual({});
  });
});

describe("cutting and merging planes", () => {
  test("cuts the selected plane with two clicks, then merges it back", () => {
    let state = run([
      {type: "selectPlane", planeId: "solar-1"},
      {type: "startCut"},
      {type: "addDraftPoint", at: at(4, 6)},
    ], loaded);
    expect(state.mode).toBe("cut");
    expect(state.planes).toHaveLength(2);
    state = run([{type: "addDraftPoint", at: at(4, -0.5)}], state);
    expect(state.mode).toBe("edit");
    expect(state.planes.map((plane) => plane.id)).toEqual(["solar-1a", "solar-1b", "solar-2"]);
    expect(state.planes[0].source).toBe("adjusted");
    expect(state.selectedPlaneId).toBe("solar-1a");
    state = run([{type: "mergePlanes", firstId: "solar-1a", secondId: "solar-1b"}], state);
    expect(state.planes).toHaveLength(2);
    expect(state.planes[0].vertices).toHaveLength(4);
    state = run([{type: "undo"}, {type: "undo"}], state);
    expect(state.planes).toEqual([solarPlane, other]);
  });

  test("a cut that misses the plane says why and changes nothing", () => {
    const state = run([
      {type: "selectPlane", planeId: "solar-1"},
      {type: "startCut"},
      {type: "addDraftPoint", at: at(30, 6)},
      {type: "addDraftPoint", at: at(30, -1)},
    ], loaded);
    expect(state.planes).toEqual([solarPlane, other]);
    expect(state.notice).toMatch(/exactly twice/);
    expect(state.mode).toBe("edit");
  });

  test("merging two whole neighbours keeps one plane; corner-only neighbours are refused", () => {
    const merged = run([{type: "mergePlanes", firstId: "solar-1", secondId: "solar-2"}], loaded);
    expect(merged.planes).toHaveLength(1);
    const far: RoofPlane = {...other, id: "solar-3", vertices: [at(10, 4), at(14, 4), at(14, 8), at(10, 8)]};
    const refused = run([{type: "load", origin, planes: [solarPlane, far]}, {type: "mergePlanes", firstId: "solar-1", secondId: "solar-3"}]);
    expect(refused.planes).toHaveLength(2);
    expect(refused.notice).toMatch(/whole edge/);
  });
});
