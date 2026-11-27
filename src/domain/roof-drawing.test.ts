import {describe, expect, test} from "vitest";
import {
  buildRoofMeasurementReport,
  computeRoofEdges,
  degreesFromPitchRise,
  estimateStories,
  fitSegmentRectangle,
  FT_PER_M,
  guessAzimuthForDrawnPlane,
  parseSolarForDrawing,
  pickActiveSquares,
  planAreaSqft,
  planeFromSolarSegment,
  planesFromSolar,
  slopedAreaSqft,
  snapToNearbyVertex,
  solarSquares,
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
