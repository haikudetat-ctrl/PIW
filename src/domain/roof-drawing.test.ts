import {describe, expect, test} from "vitest";
import {
  buildingAxisDegrees,
  mergePlanes,
  buildRoofMeasurementReport,
  computeRoofEdges,
  degreesFromPitchRise,
  estimateStories,
  fitSegmentRectangle,
  FT_PER_M,
  guessAzimuthForDrawnPlane,
  parseSolarForDrawing,
  pickActiveSquares,
  orthoSnapCorner,
  planAreaSqft,
  planeFromSolarSegment,
  planePairKey,
  planesFromSolar,
  slopedAreaSqft,
  snapToNearbyVertex,
  solarSquares,
  splitPlane,
  squareUpPlane,
  SQFT_PER_M2,
  toLatLng,
  toLocal,
  type RoofEdgeKind,
  type RoofPlane,
} from "./roof-drawing";

const origin = {lat: 40.35, lng: -74.07};
const at = (x: number, y: number) => toLatLng(origin, {x, y});
const SIX_TWELVE = degreesFromPitchRise(6);

function plane(id: string, points: Array<[number, number]>, azimuthDegrees: number, pitchDegrees = SIX_TWELVE): RoofPlane {
  return {
    id,
    vertices: points.map(([x, y]) => at(x, y)),
    azimuthDegrees,
    pitchDegrees,
    source: "drawn",
    solarSlopedAreaSqft: null,
  };
}

function totals(edges: ReturnType<typeof computeRoofEdges>) {
  const sum: Partial<Record<RoofEdgeKind, number>> = {};
  edges.forEach((edge) => {
    sum[edge.kind] = (sum[edge.kind] ?? 0) + edge.trueLengthFt;
  });
  return sum;
}

// 10 m east-west by 8 m north-south gable, ridge running east-west at y = 0.
const gable = [
  plane("a-north", [[-5, 0], [5, 0], [5, 4], [-5, 4]], 0),
  plane("b-south", [[-5, -4], [5, -4], [5, 0], [-5, 0]], 180),
];

describe("projection", () => {
  test("round-trips local metres through lat/lng", () => {
    const point = toLocal(origin, at(12.5, -7.25));
    expect(point.x).toBeCloseTo(12.5, 6);
    expect(point.y).toBeCloseTo(-7.25, 6);
  });
});

describe("plane areas", () => {
  test("sloped area is plan area divided by the cosine of the pitch", () => {
    const north = gable[0];
    expect(planAreaSqft(origin, north.vertices)).toBeCloseTo(40 * SQFT_PER_M2, 3);
    expect(slopedAreaSqft(origin, north)).toBeCloseTo((40 * SQFT_PER_M2) / Math.cos((SIX_TWELVE * Math.PI) / 180), 3);
  });
});

describe("edge detection", () => {
  test("a gable has one ridge, two eaves and four rakes", () => {
    const edges = computeRoofEdges(origin, gable);
    const counts = edges.reduce<Record<string, number>>((acc, edge) => ({...acc, [edge.kind]: (acc[edge.kind] ?? 0) + 1}), {});
    expect(counts).toEqual({ridge: 1, eave: 2, rake: 4});
    const sum = totals(edges);
    expect(sum.ridge).toBeCloseTo(10 * FT_PER_M, 2);
    expect(sum.eave).toBeCloseTo(20 * FT_PER_M, 2);
    // Rakes run up the slope: 4 m of plan per side, longer on the roof.
    expect(sum.rake).toBeCloseTo((16 * FT_PER_M) / Math.cos((SIX_TWELVE * Math.PI) / 180), 2);
    expect(edges.every((edge) => !edge.needsReview)).toBe(true);
  });

  test("a pyramid hip roof has four hips and four eaves", () => {
    const hip = [
      plane("n", [[-5, 5], [0, 0], [5, 5]], 0),
      plane("e", [[5, 5], [0, 0], [5, -5]], 90),
      plane("s", [[5, -5], [0, 0], [-5, -5]], 180),
      plane("w", [[-5, -5], [0, 0], [-5, 5]], 270),
    ];
    const edges = computeRoofEdges(origin, hip);
    const counts = edges.reduce<Record<string, number>>((acc, edge) => ({...acc, [edge.kind]: (acc[edge.kind] ?? 0) + 1}), {});
    expect(counts).toEqual({hip: 4, eave: 4});
    const hipEdge = edges.find((edge) => edge.kind === "hip")!;
    expect(hipEdge.trueLengthFt).toBeGreaterThan(hipEdge.planLengthFt);
  });

  test("two planes that both drain to a shared edge form a valley", () => {
    const butterfly = [
      plane("a", [[-5, 0], [5, 0], [5, 4], [-5, 4]], 180),
      plane("b", [[-5, -4], [5, -4], [5, 0], [-5, 0]], 0),
    ];
    const edges = computeRoofEdges(origin, butterfly);
    expect(edges.filter((edge) => edge.kind === "valley")).toHaveLength(1);
  });

  test("an open top edge defaults to ridge and is flagged for review", () => {
    const edges = computeRoofEdges(origin, [gable[0]]);
    const top = edges.filter((edge) => edge.needsReview);
    expect(top).toHaveLength(1);
    expect(top[0].kind).toBe("ridge");
  });

  test("a partly shared edge is split into a shared piece and an open piece", () => {
    const porch = plane("c-porch", [[5, -2], [9, -2], [9, 0], [5, 0]], 180, degreesFromPitchRise(3));
    const lean = plane("d-wall", [[0, 0], [9, 0], [9, 3], [0, 3]], 0);
    const edges = computeRoofEdges(origin, [lean, porch]);
    const southOfLean = edges.filter((edge) => edge.planeIds.includes("d-wall") && edge.planLengthFt > 0
      && Math.abs(toLocal(origin, edge.start).y) < 0.01 && Math.abs(toLocal(origin, edge.end).y) < 0.01);
    const shared = southOfLean.find((edge) => edge.planeIds.length === 2)!;
    const open = southOfLean.find((edge) => edge.planeIds.length === 1)!;
    expect(shared.planLengthFt).toBeCloseTo(4 * FT_PER_M, 2);
    expect(open.planLengthFt).toBeCloseTo(5 * FT_PER_M, 2);
  });

  test("edges a little apart still count as shared", () => {
    const nudged = [gable[0], plane("b-south", [[-5, -4], [5, -4], [5, -0.4], [-5, -0.4]], 180)];
    expect(computeRoofEdges(origin, nudged).filter((edge) => edge.kind === "ridge" && edge.planeIds.length === 2)).toHaveLength(1);
  });

  test("an override replaces the automatic label", () => {
    const edges = computeRoofEdges(origin, gable);
    const ridge = edges.find((edge) => edge.kind === "ridge")!;
    const overridden = computeRoofEdges(origin, gable, {[ridge.id]: "wall_flashing"});
    const same = overridden.find((edge) => edge.id === ridge.id)!;
    expect(same.kind).toBe("wall_flashing");
    expect(same.autoKind).toBe("ridge");
    expect(same.overridden).toBe(true);
  });
});

describe("levels, wall faces and folds (from the 132 Windsor Ave drawing)", () => {
  const withHeight = (p: RoofPlane, x: number, y: number, meters: number): RoofPlane => ({...p, heightRef: {at: at(x, y), meters}});

  test("a steep overhang below a higher roof keeps its own edges instead of joining it", () => {
    // Main roof faces west; its eave line at x = 0 sits about 6.3 m up.
    const main = withHeight(plane("a-main", [[0, 0], [6, 0], [6, 8], [0, 8]], 270, degreesFromPitchRise(5)), 3, 4, 7.5);
    // A 20/12 pent section below it on the same line, about 3.5 m up at its top.
    const pent = withHeight(plane("b-pent", [[-1.2, 0], [0, 0], [0, 8], [-1.2, 8]], 270, degreesFromPitchRise(20)), -0.6, 4, 2.5);
    const edges = computeRoofEdges(origin, [main, pent]);
    expect(edges.every((edge) => edge.planeIds.length === 1)).toBe(true);
    const onLine = edges.filter((edge) => Math.abs(toLocal(origin, edge.start).x) < 0.01 && Math.abs(toLocal(origin, edge.end).x) < 0.01);
    expect(onLine.find((edge) => edge.planeIds[0] === "a-main")?.kind).toBe("eave");
    expect(onLine.find((edge) => edge.planeIds[0] === "b-pent")?.kind).toBe("wall_flashing");
  });

  test("planes at the same height still share the edge", () => {
    const north = withHeight(gable[0], 0, 2, 5);
    const south = withHeight(gable[1], 0, -2, 5);
    expect(computeRoofEdges(origin, [north, south]).some((edge) => edge.kind === "ridge" && edge.planeIds.length === 2)).toBe(true);
  });

  test("a pitch break between planes facing the same way is a pitch change", () => {
    const upper = plane("a-upper", [[-5, 0], [5, 0], [5, 4], [-5, 4]], 180, degreesFromPitchRise(12));
    const lower = plane("b-lower", [[-5, -3], [5, -3], [5, 0], [-5, 0]], 180, degreesFromPitchRise(4));
    expect(computeRoofEdges(origin, [upper, lower]).find((edge) => edge.planeIds.length === 2)?.kind).toBe("transition");
  });

  test("two roof planes meeting on a diagonal are a hip or a valley, never step flashing", () => {
    const facesNorth = plane("a", [[0, 0], [5, 5], [0, 5]], 0);
    const facesEast = plane("b", [[0, 0], [5, 0], [5, 5]], 90);
    const hip = computeRoofEdges(origin, [facesNorth, facesEast]).find((edge) => edge.planeIds.length === 2);
    expect(hip?.kind).toBe("hip");
    const facesSouth = {...facesNorth, azimuthDegrees: 180};
    const facesWest = {...facesEast, azimuthDegrees: 270};
    expect(computeRoofEdges(origin, [facesSouth, facesWest]).find((edge) => edge.planeIds.length === 2)?.kind).toBe("valley");
    const mixed = computeRoofEdges(origin, [facesNorth, facesWest]);
    expect(mixed.some((edge) => edge.kind === "step_flashing")).toBe(false);
  });

  test("splitting a joined edge gives each plane its own labelled, counted edge", () => {
    // Upper roof drips onto a lower porch roof that runs up under it.
    const upper = plane("a-upper", [[-5, 0], [5, 0], [5, 4], [-5, 4]], 180, degreesFromPitchRise(8));
    const lower = plane("b-lower", [[-5, -3], [5, -3], [5, 0], [-5, 0]], 180, degreesFromPitchRise(3));
    const joined = computeRoofEdges(origin, [upper, lower]);
    const shared = joined.filter((edge) => edge.planeIds.length === 2);
    expect(shared).toHaveLength(1);
    expect(shared[0].pair).toEqual({key: planePairKey("a-upper", "b-lower"), otherPlaneId: "b-lower", joined: true});

    const split = computeRoofEdges(origin, [upper, lower], {}, {[planePairKey("a-upper", "b-lower")]: "split"});
    const alongLine = split.filter((edge) => edge.pair?.key === planePairKey("a-upper", "b-lower"));
    expect(alongLine).toHaveLength(2);
    expect(alongLine.every((edge) => edge.pair?.joined === false)).toBe(true);
    expect(alongLine.find((edge) => edge.planeIds[0] === "a-upper")?.kind).toBe("eave");
    expect(alongLine.find((edge) => edge.planeIds[0] === "b-lower")?.kind).toBe("wall_flashing");
    const sum = (edges: typeof split) => edges.reduce((total, edge) => total + edge.trueLengthFt, 0);
    // Joined counts the line once; split counts both sides.
    expect(sum(alongLine)).toBeCloseTo(2 * shared[0].trueLengthFt, 4);
  });

  test("planes on different levels can still be joined by hand", () => {
    const main = {...plane("a-main", [[0, 0], [6, 0], [6, 8], [0, 8]], 270, degreesFromPitchRise(5)), heightRef: {at: at(3, 4), meters: 7.5}};
    const pent = {...plane("b-pent", [[-1.2, 0], [0, 0], [0, 8], [-1.2, 8]], 270, degreesFromPitchRise(20)), heightRef: {at: at(-0.6, 4), meters: 2.5}};
    const key = planePairKey("a-main", "b-pent");
    expect(computeRoofEdges(origin, [main, pent]).find((edge) => edge.pair?.key === key)?.pair?.joined).toBe(false);
    const joined = computeRoofEdges(origin, [main, pent], {}, {[key]: "join"});
    expect(joined.filter((edge) => edge.pair?.key === key)).toHaveLength(1);
    expect(joined.find((edge) => edge.pair?.key === key)?.kind).toBe("transition");
  });

  test("a face marked as wall is left out of squares and turns its roof edge into flashing", () => {
    const roof = plane("a-roof", [[-5, -4], [5, -4], [5, 0], [-5, 0]], 180);
    const cheek: RoofPlane = {...plane("b-cheek", [[-5, 0], [5, 0], [5, 0.5], [-5, 0.5]], 180, degreesFromPitchRise(20)), surface: "wall"};
    const edges = computeRoofEdges(origin, [roof, cheek]);
    expect(edges.find((edge) => edge.planeIds.length === 2)?.kind).toBe("wall_flashing");
    expect(edges.some((edge) => edge.planeIds.length === 1 && edge.planeIds[0] === "b-cheek")).toBe(false);
    const report = buildRoofMeasurementReport(origin, [roof, cheek], edges);
    expect(report.planeCount).toBe(1);
    expect(report.wallPlaneCount).toBe(1);
    expect(report.wallSqft).toBeGreaterThan(0);
    expect(report.squares).toBeCloseTo(slopedAreaSqft(origin, roof) / 100, 6);
  });

  test("flags steep area for the steep charge and very steep planes as possible walls", () => {
    const steep = plane("a-steep", [[0, 0], [4, 0], [4, 2], [0, 2]], 270, degreesFromPitchRise(20));
    const report = buildRoofMeasurementReport(origin, [gable[0], steep], []);
    expect(report.steepSqft).toBeCloseTo(slopedAreaSqft(origin, steep), 6);
    expect(report.possibleWallPlaneIds).toEqual(["a-steep"]);
    // Still counted as roof unless someone marks it.
    expect(report.planeCount).toBe(2);
  });
});

describe("snapping", () => {
  test("snaps to another plane's corner within tolerance and ignores the moving plane", () => {
    const snapped = snapToNearbyVertex(origin, at(5.3, 0.2), gable, "a-north");
    const local = toLocal(origin, snapped);
    expect(local.x).toBeCloseTo(5, 6);
    expect(local.y).toBeCloseTo(0, 6);
    const free = toLocal(origin, snapToNearbyVertex(origin, at(7, 0), gable, "a-north"));
    expect(free.x).toBeCloseTo(7, 6);
  });
});

describe("drawn plane azimuth", () => {
  test("faces out across the longest edge", () => {
    const vertices = [at(0, 0), at(10, 0), at(10, 3), at(0, 3)];
    // Two long edges tie; the first (south edge) wins, so the plane faces south.
    expect(guessAzimuthForDrawnPlane(origin, vertices)).toBeCloseTo(180, 6);
  });
});

describe("Solar segments", () => {
  test("recovers a rotated rectangle from its axis-aligned box", () => {
    const theta = (30 * Math.PI) / 180;
    const fit = fitSegmentRectangle({
      azimuthDegrees: 30,
      boxWidthM: 10 * Math.cos(theta) + 4 * Math.sin(theta),
      boxHeightM: 10 * Math.sin(theta) + 4 * Math.cos(theta),
      groundAreaM2: 40,
    });
    expect(fit.width).toBeCloseTo(10, 6);
    expect(fit.depth).toBeCloseTo(4, 6);
  });

  test("keeps Solar's ground area when the box is larger than the plane", () => {
    const fit = fitSegmentRectangle({azimuthDegrees: 0, boxWidthM: 12, boxHeightM: 5, groundAreaM2: 40});
    expect(fit.width * fit.depth).toBeCloseTo(40, 6);
    expect(fit.width / fit.depth).toBeCloseTo(12 / 5, 6);
  });

  test("falls back to a square for diagonal planes", () => {
    const fit = fitSegmentRectangle({azimuthDegrees: 45, boxWidthM: 9, boxHeightM: 9, groundAreaM2: 36});
    expect(fit.width).toBeCloseTo(6, 6);
    expect(fit.depth).toBeCloseTo(6, 6);
  });

  const raw = {
    name: "buildings/test",
    center: {latitude: origin.lat, longitude: origin.lng},
    imageryDate: {year: 2024, month: 5, day: 3},
    imageryQuality: "HIGH",
    solarPotential: {
      buildingStats: {areaMeters2: 110, groundAreaMeters2: 98},
      wholeRoofStats: {areaMeters2: 100, groundAreaMeters2: 90},
      roofSegmentStats: [
        {
          pitchDegrees: SIX_TWELVE,
          azimuthDegrees: 180,
          stats: {areaMeters2: 50, groundAreaMeters2: 44.72},
          center: {latitude: at(0, -2).lat, longitude: at(0, -2).lng},
          boundingBox: {
            sw: {latitude: at(-5.5, -4.2).lat, longitude: at(-5.5, -4.2).lng},
            ne: {latitude: at(5.5, 0.2).lat, longitude: at(5.5, 0.2).lng},
          },
          planeHeightAtCenterMeters: 30 + 6.2,
        },
        {
          pitchDegrees: SIX_TWELVE,
          azimuthDegrees: 0,
          stats: {areaMeters2: 50, groundAreaMeters2: 44.72},
          center: {latitude: at(0, 2).lat, longitude: at(0, 2).lng},
          boundingBox: {
            sw: {latitude: at(-5.5, -0.2).lat, longitude: at(-5.5, -0.2).lng},
            ne: {latitude: at(5.5, 4.2).lat, longitude: at(5.5, 4.2).lng},
          },
          planeHeightAtCenterMeters: 30 + 6.2,
        },
        {
          pitchDegrees: 10,
          azimuthDegrees: 90,
          stats: {areaMeters2: 0.8, groundAreaMeters2: 0.79},
          center: {latitude: origin.lat, longitude: origin.lng},
          boundingBox: {
            sw: {latitude: origin.lat, longitude: origin.lng},
            ne: {latitude: at(1, 1).lat, longitude: at(1, 1).lng},
          },
        },
      ],
    },
  };

  test("parses segments, squares tiers and drops Solar noise", () => {
    const insight = parseSolarForDrawing(raw);
    expect(insight.imageryDate).toBe("2024-05-03");
    expect(insight.segments).toHaveLength(3);
    const planes = planesFromSolar(insight);
    expect(planes).toHaveLength(2);
    const tiers = solarSquares(insight);
    expect(tiers.facetSumSquares).toBeCloseTo((100.8 * SQFT_PER_M2) / 100, 4);
    expect(tiers.buildingSquares).toBeCloseTo((110 * SQFT_PER_M2) / 100, 4);
    expect(tiers.blendedSquares).toBeCloseTo((tiers.facetSumSquares + (tiers.buildingSquares as number)) / 2, 6);
  });

  test("a Solar plane keeps the segment's ground area, pitch and facing", () => {
    const insight = parseSolarForDrawing(raw);
    const first = planeFromSolarSegment(origin, insight.segments[0]);
    expect(planAreaSqft(origin, first.vertices)).toBeCloseTo(44.72 * SQFT_PER_M2, 2);
    expect(first.pitchDegrees).toBeCloseTo(SIX_TWELVE, 6);
    expect(first.azimuthDegrees).toBe(180);
    expect(first.source).toBe("solar");
  });

  test("two Solar gable halves come out sharing a ridge", () => {
    const planes = planesFromSolar(parseSolarForDrawing(raw), origin);
    const edges = computeRoofEdges(origin, planes);
    expect(edges.some((edge) => edge.kind === "ridge" && edge.planeIds.length === 2)).toBe(true);
  });

  test("rejects responses without segment geometry", () => {
    expect(() => parseSolarForDrawing({name: "x", center: {latitude: 1, longitude: 1}, solarPotential: {roofSegmentStats: []}})).toThrow();
  });

  test("estimates stories only when a ground elevation is known", () => {
    const insight = parseSolarForDrawing(raw);
    expect(estimateStories(insight, null).stories).toBe("unknown");
    const estimate = estimateStories(insight, 30);
    expect(estimate.stories).toBe("two");
    expect(estimate.eaveHeightFt).toBeGreaterThan(14);
  });
});

describe("report", () => {
  test("totals squares, pitch, lengths and waste for a gable", () => {
    const report = buildRoofMeasurementReport(origin, gable, computeRoofEdges(origin, gable));
    const sloped = (80 * SQFT_PER_M2) / Math.cos((SIX_TWELVE * Math.PI) / 180);
    expect(report.totalSlopedSqft).toBeCloseTo(sloped, 2);
    expect(report.squares).toBeCloseTo(sloped / 100, 4);
    expect(report.predominantPitchRise).toBe(6);
    expect(report.suggestedWastePercent).toBe(10);
    const tenPercent = report.wasteTable.find((row) => row.percent === 10)!;
    expect(tenPercent.squares).toBeCloseTo((sloped / 100) * 1.1, 4);
    expect(tenPercent.bundles).toBe(Math.ceil(tenPercent.squares * 3));
  });

  test("picks measured, then an edited drawing, then Solar blended squares", () => {
    const solar = {facetSumSquares: 20, buildingSquares: 22, blendedSquares: 21};
    const untouched = buildRoofMeasurementReport(origin, gable.map((p) => ({...p, source: "solar" as const})), []);
    const edited = buildRoofMeasurementReport(origin, gable, []);
    expect(pickActiveSquares({solar, drawn: untouched, measured: null})).toEqual({tier: "solar", squares: 21});
    expect(pickActiveSquares({solar, drawn: edited, measured: null})?.tier).toBe("drawn");
    expect(pickActiveSquares({solar, drawn: edited, measured: {source: "Roofr", totalSqft: 2450, predominantPitchRise: 6, lengthsFt: {}}}))
      .toEqual({tier: "measured", squares: 24.5});
    expect(pickActiveSquares({solar: null, drawn: null, measured: null})).toBeNull();
  });
});

describe("90-degree helpers", () => {
  const rotate = (x: number, y: number, deg: number): [number, number] => {
    const r = (deg * Math.PI) / 180;
    return [x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r)];
  };

  test("finds a building rotated 20 degrees from north from its plane facings", () => {
    const planes = [plane("a", [[0, 0], [10, 0], [10, 4], [0, 4]], 20), plane("b", [[0, -4], [10, -4], [10, 0], [0, 0]], 200), plane("c", [[10, -4], [14, -4], [14, 4], [10, 4]], 110)];
    expect(buildingAxisDegrees(origin, planes)).toBeCloseTo(20, 6);
  });

  test("snaps a dragged corner square to both neighbours on the building axes", () => {
    // Axis at 20 degrees; neighbours sit on a rotated rectangle's corners.
    const [px, py] = rotate(0, 0, 20);
    const [nx, ny] = rotate(10, 4, 20);
    const [cx, cy] = rotate(10, 0, 20);
    const result = orthoSnapCorner({origin, previous: at(px, py), next: at(nx, ny), proposed: at(cx + 0.4, cy - 0.3), axisDegrees: 20});
    expect(result.snapped).toBe(true);
    const local = toLocal(origin, result.point);
    expect(local.x).toBeCloseTo(cx, 4);
    expect(local.y).toBeCloseTo(cy, 4);
  });

  test("leaves a corner alone when neither edge is near an axis", () => {
    const result = orthoSnapCorner({origin, previous: at(0, 0), next: at(10, 10), proposed: at(6, 3), axisDegrees: 0});
    expect(result.snapped).toBe(false);
  });

  test("squares up a skewed plane onto the axes and keeps a diagonal edge's ends", () => {
    const skewed = plane("s", [[0, 0], [10, 0.6], [10.4, 4], [-0.3, 4.2]], 0);
    const squared = squareUpPlane(origin, skewed, 0);
    const pts = squared.vertices.map((v) => toLocal(origin, v));
    // Opposite edges now parallel to the axes: equal y along the bottom, equal x on the sides.
    expect(pts[0].y).toBeCloseTo(pts[1].y, 6);
    expect(pts[1].x).toBeCloseTo(pts[2].x, 6);
    expect(pts[2].y).toBeCloseTo(pts[3].y, 6);
    expect(pts[3].x).toBeCloseTo(pts[0].x, 6);
    expect(squared.source).toBe("drawn");

    const hipEnd = plane("h", [[0, 0], [10, 0], [5, 5]], 180);
    const kept = squareUpPlane(origin, hipEnd, 0).vertices.map((v) => toLocal(origin, v));
    expect(kept[2].x).toBeCloseTo(5, 6);
    expect(kept[2].y).toBeCloseTo(5, 6);
  });
});

describe("plane split and merge", () => {
  const box = plane("p", [[0, 0], [10, 0], [10, 4], [0, 4]], 180);

  test("cuts a plane in two along a line, keeping its pitch and splitting its area", () => {
    const result = splitPlane(origin, {...box, solarSlopedAreaSqft: 500}, at(4, -1), at(4, 5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [left, right] = result.planes;
    const areas = result.planes.map((half) => planAreaSqft(origin, half.vertices));
    expect(areas[0] + areas[1]).toBeCloseTo(planAreaSqft(origin, box.vertices), 3);
    expect(Math.min(...areas) / Math.max(...areas)).toBeCloseTo(4 / 6, 3);
    expect(left.pitchDegrees).toBe(box.pitchDegrees);
    expect(new Set([left.id, right.id]).size).toBe(2);
    expect((left.solarSlopedAreaSqft ?? 0) + (right.solarSlopedAreaSqft ?? 0)).toBeCloseTo(500, 6);
    // The halves meet along the cut and join back into one ridge-free edge.
    expect(computeRoofEdges(origin, result.planes).filter((edge) => edge.planeIds.length === 2)).toHaveLength(1);
  });

  test("refuses a cut that misses or crosses an L-shape more than twice", () => {
    expect(splitPlane(origin, box, at(20, 0), at(20, 5)).ok).toBe(false);
    const ell = plane("l", [[0, 0], [10, 0], [10, 2], [2, 2], [2, 6], [0, 6]], 180);
    expect(splitPlane(origin, ell, at(-1, 1), at(11, 1)).ok).toBe(true);
    expect(splitPlane(origin, ell, at(1, -1), at(1, 7)).ok).toBe(true);
    // Enters the upright arm, leaves it, then crosses the bottom arm: four crossings.
    expect(splitPlane(origin, ell, at(-1, 5), at(11, -1)).ok).toBe(false);
  });

  test("merges two planes that share a whole edge back into one outline", () => {
    const left = plane("a", [[0, 0], [4, 0], [4, 4], [0, 4]], 180);
    const right = plane("b", [[4, 0], [10, 0], [10, 4], [4, 4]], 180);
    const result = mergePlanes(origin, left, right);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.planes).toHaveLength(1);
    expect(result.planes[0].vertices).toHaveLength(4);
    expect(planAreaSqft(origin, result.planes[0].vertices)).toBeCloseTo(40 * SQFT_PER_M2, 2);
    expect(result.planes[0].id).toBe("b");
  });

  test("merges a split plane back to its original area", () => {
    const halves = splitPlane(origin, box, at(4, -1), at(4, 5));
    if (!halves.ok) throw new Error("split failed");
    const back = mergePlanes(origin, halves.planes[0], halves.planes[1]);
    expect(back.ok).toBe(true);
    if (back.ok) expect(planAreaSqft(origin, back.planes[0].vertices)).toBeCloseTo(planAreaSqft(origin, box.vertices), 3);
  });

  test("refuses planes that only touch at a corner", () => {
    const left = plane("a", [[0, 0], [4, 0], [4, 4], [0, 4]], 180);
    const corner = plane("b", [[4, 4], [8, 4], [8, 8], [4, 8]], 180);
    expect(mergePlanes(origin, left, corner).ok).toBe(false);
  });
});
