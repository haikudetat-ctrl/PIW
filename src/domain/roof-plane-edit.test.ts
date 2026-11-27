import {describe, expect, test} from "vitest";
import {degreesFromPitchRise, distanceMeters, FT_PER_M, toLatLng, toLocal, type RoofPlane} from "./roof-drawing";
import {carrySharedCorners, planeSides, resizePlaneSide, translatePlane} from "./roof-plane-edit";

const origin = {lat: 39.434, lng: -74.936};
const at = (x: number, y: number) => toLatLng(origin, {x, y});
const local = (point: {lat: number; lng: number}) => toLocal(origin, point);

function plane(id: string, points: Array<[number, number]>, rise = 0, azimuth = 180): RoofPlane {
  return {id, vertices: points.map(([x, y]) => at(x, y)), pitchDegrees: degreesFromPitchRise(rise), azimuthDegrees: azimuth, source: "solar", solarSlopedAreaSqft: null};
}

// 10 m east-west by 6 m north-south, counter-clockwise from the south-west corner.
const rectangle = plane("p1", [[0, 0], [10, 0], [10, 6], [0, 6]]);

describe("plane sides", () => {
  test("letters corners and reports lengths and facing", () => {
    const sides = planeSides(origin, rectangle);
    expect(sides.map((side) => side.label)).toEqual(["A–B", "B–C", "C–D", "D–A"]);
    expect(sides.map((side) => side.faces)).toEqual(["S", "E", "N", "W"]);
    expect(sides[0].trueLengthFt).toBeCloseTo(10 * FT_PER_M, 1);
  });

  test("a side running up the slope is longer along the roof", () => {
    // Faces south at 12/12, so the east side (B–C) climbs at 45 degrees.
    const steep = plane("p1", [[0, 0], [10, 0], [10, 6], [0, 6]], 12, 180);
    const sides = planeSides(origin, steep);
    expect(sides[1].trueLengthFt).toBeCloseTo(6 * Math.SQRT2 * FT_PER_M, 1);
    expect(sides[0].trueLengthFt).toBeCloseTo(10 * FT_PER_M, 1);
  });
});

describe("exact side lengths", () => {
  test("stretches a rectangle from its first corner and keeps it square", () => {
    const result = resizePlaneSide(origin, rectangle, 0, 40, "start");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b, c, d] = result.plane.vertices.map(local);
    expect(a.x).toBeCloseTo(0, 6);
    expect(b.x).toBeCloseTo(40 / FT_PER_M, 3);
    expect(c.x).toBeCloseTo(40 / FT_PER_M, 3);
    expect(c.y).toBeCloseTo(6, 3);
    expect(d.x).toBeCloseTo(0, 6);
    expect(planeSides(origin, result.plane)[0].trueLengthFt).toBeCloseTo(40, 2);
    expect(result.plane.source).toBe("adjusted");
    expect(result.moves).toHaveLength(2);
  });

  test("keeps the second corner when asked", () => {
    const result = resizePlaneSide(origin, rectangle, 0, 20, "end");
    if (!result.ok) throw new Error(result.reason);
    const [a, b, , d] = result.plane.vertices.map(local);
    expect(b.x).toBeCloseTo(10, 6);
    expect(a.x).toBeCloseTo(10 - 20 / FT_PER_M, 3);
    expect(d.x).toBeCloseTo(10 - 20 / FT_PER_M, 3);
  });

  test("sets the along-the-roof length on a sloped side", () => {
    const steep = plane("p1", [[0, 0], [10, 0], [10, 6], [0, 6]], 12, 180);
    const result = resizePlaneSide(origin, steep, 1, 30, "start");
    if (!result.ok) throw new Error(result.reason);
    expect(planeSides(origin, result.plane)[1].trueLengthFt).toBeCloseTo(30, 2);
  });

  test("moves only the far corner when it is not square", () => {
    const skewed = plane("p1", [[0, 0], [10, 0], [14, 6], [0, 6]]);
    const result = resizePlaneSide(origin, skewed, 0, 40, "start");
    if (!result.ok) throw new Error(result.reason);
    expect(local(result.plane.vertices[2]).x).toBeCloseTo(14, 6);
    expect(result.moves).toHaveLength(1);
  });

  test("refuses lengths under a foot", () => {
    expect(resizePlaneSide(origin, rectangle, 0, 0.5, "start").ok).toBe(false);
    expect(resizePlaneSide(origin, rectangle, 9, 10, "start").ok).toBe(false);
  });
});

describe("moving planes", () => {
  // A second plane sharing the rectangle's north side (C–D).
  const north = plane("p2", [[0, 6], [10, 6], [10, 11], [0, 11]], 6, 0);

  test("translates every corner and the height reference", () => {
    const withHeight = {...rectangle, heightRef: {at: at(5, 3), meters: 30}};
    const result = translatePlane(origin, withHeight, {x: 1, y: -0.5});
    if (!result.ok) throw new Error(result.reason);
    expect(local(result.plane.vertices[0])).toEqual({x: expect.closeTo(1, 6), y: expect.closeTo(-0.5, 6)});
    expect(local(result.plane.heightRef!.at).x).toBeCloseTo(6, 6);
  });

  test("carries a joined neighbour's shared corners", () => {
    const result = translatePlane(origin, rectangle, {x: 0, y: 1});
    if (!result.ok) throw new Error(result.reason);
    const planes = carrySharedCorners(origin, [result.plane, north], "p1", result.moves, {});
    const moved = planes[1].vertices.map(local);
    expect(moved[0].y).toBeCloseTo(7, 6);
    expect(moved[1].y).toBeCloseTo(7, 6);
    expect(moved[2].y).toBeCloseTo(11, 6);
    expect(distanceMeters(planes[0].vertices[3], planes[1].vertices[0])).toBeLessThan(0.001);
  });

  test("leaves a split neighbour where it is", () => {
    const result = translatePlane(origin, rectangle, {x: 0, y: 1});
    if (!result.ok) throw new Error(result.reason);
    const planes = carrySharedCorners(origin, [result.plane, north], "p1", result.moves, {"p1|p2": "split"});
    expect(planes[1]).toBe(north);
  });
});
