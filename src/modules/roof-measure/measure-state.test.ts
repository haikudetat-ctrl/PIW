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

  test("clears an edge override", () => {
    const state = run([{type: "setEdgeKind", edgeId: "e", kind: "hip"}, {type: "setEdgeKind", edgeId: "e", kind: null}], loaded);
    expect(state.overrides).toEqual({});
  });
});
