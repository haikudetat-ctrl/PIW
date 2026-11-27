import {describe, expect, test} from "vitest";
import {njGridQuadAt, njGridQuadsForBox, njQuadFileUrl, parseTileRequest, stretchToByte} from "./nj-ortho";

describe("NJ orthoimagery grid", () => {
  // South-west corners of real 2025 files (read from their GeoTIFF headers, Nov 27, 2026).
  test.each([
    ["A15B12", 225000, 350000],
    ["C16B1", 290000, 320000],
    ["D8B9", 330000, 630000],
    ["E8B12", 385000, 630000],
    ["G12D11", 460000, 450000],
    ["H1C1", 470000, 900000],
    ["J10B1", 570000, 560000],
    ["L11A2", 635000, 520000],
  ])("names cell %s from its south-west corner", (cell, west, south) => {
    expect(njGridQuadAt(west + 10, south + 10)).toEqual({cell, quad: "SW", bounds: [west, south, west + 2500, south + 2500]});
    expect(njGridQuadAt(west + 4990, south + 4990)?.quad).toBe("NE");
    expect(njGridQuadAt(west + 4990, south + 4990)?.cell).toBe(cell);
  });

  test("finds the Vineland test roof's file", () => {
    // 5040 Ascher Rd, Vineland, in NJ State Plane feet.
    const quad = njGridQuadAt(369035.47, 219085.38);
    expect(quad).toEqual({cell: "E18C8", quad: "NE", bounds: [367500, 217500, 370000, 220000]});
    expect(njQuadFileUrl(quad!)).toBe("https://njogis-imagery.s3.amazonaws.com/2025/cog/E18C8_NE.tif");
  });

  test("lists every quadrant a box crosses", () => {
    const quads = njGridQuadsForBox([369900, 219900, 370100, 220100]);
    expect(quads).toHaveLength(4);
    expect(new Set(quads.map((quad) => quad.bounds.join(","))).size).toBe(4);
  });

  test("refuses points west of the grid", () => {
    expect(njGridQuadAt(100000, 400000)).toBeNull();
  });
});

describe("tile requests", () => {
  test("accepts zoom 19 and 20 tiles over New Jersey", () => {
    // Vineland at zoom 20.
    expect(parseTileRequest("20", "306021", "399111.jpg")).toEqual({z: 20, x: 306021, y: 399111});
  });

  test("refuses other zooms, junk and tiles away from New Jersey", () => {
    expect(parseTileRequest("18", "76505", "99777.jpg")).toBeNull();
    expect(parseTileRequest("21", "612042", "798222.jpg")).toBeNull();
    expect(parseTileRequest("20", "abc", "1.jpg")).toBeNull();
    // Kansas.
    expect(parseTileRequest("20", "250000", "400000.jpg")).toBeNull();
  });
});

test("stretches 16-bit values to bytes with fixed ends", () => {
  expect(stretchToByte(0, 0)).toBe(0);
  expect(stretchToByte(65535, 1)).toBe(255);
  expect(stretchToByte((6136 + 54162) / 2, 0)).toBe(128);
});
