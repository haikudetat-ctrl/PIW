// New Jersey's statewide orthoimagery, for the staff roof measuring page.
//
// The 2025 capture (6-inch, leaf-off) is published only as Cloud Optimized
// GeoTIFFs in the state's public S3 bucket, not as map tiles, so PIW renders
// Web Mercator tiles from it on demand (see nj-ortho-tiles.ts). This file holds
// the pure parts: the state's tile grid naming and Web Mercator tile math.
//
// The 2025 files are NJ State Plane (EPSG:6527, NAD83(2011), US survey feet),
// 0.5 ft pixels, 4 bands (red, green, blue, near infrared) of 16-bit values,
// one file per 2,500 ft quadrant of a 5,000 ft grid cell:
//   2025/cog/E18C8_NE.tif
// The 2020 capture (1 ft) is what the NJGIN tile service serves; its COGs use
// the same grid names without the quadrant suffix.

export const NJ_2025_BUCKET_URL = "https://njogis-imagery.s3.amazonaws.com/2025/cog";

export type NjImageryLayer = "nj2025" | "nj2020";

export const NJ_IMAGERY_LABELS: Record<NjImageryLayer, string> = {
  nj2025: "NJ 2025 aerial (6-inch, leaf-off)",
  nj2020: "NJ 2020 aerial (1-foot, leaf-off)",
};

// The state's grid: 40,000 ft blocks named by a column letter (A from x =
// 190,000 ft) and a row number (1 from y = 925,000 ft, counting south); each
// block has four 20,000 ft quarters A (NW), B (NE), C (SW), D (SE), and each
// quarter sixteen 5,000 ft cells numbered across then down. Checked against
// 80 files spread over the state on Nov 27, 2026.
const GRID_X0 = 190_000;
const GRID_Y_TOP = 925_000;
const BLOCK_FT = 40_000;
const QUARTER_FT = 20_000;
export const CELL_FT = 5_000;
export const QUAD_FT = 2_500;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type NjGridQuad = {
  /** Cell name, e.g. E18C8. */
  cell: string;
  /** Quadrant suffix of the 2025 file. */
  quad: "NE" | "NW" | "SE" | "SW";
  /** Bounds of the quadrant file in State Plane feet: west, south, east, north. */
  bounds: [number, number, number, number];
};

/** The 2025 quadrant file covering a State Plane point (feet), or null outside the grid. */
export function njGridQuadAt(x: number, y: number): NjGridQuad | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const column = Math.floor((x - GRID_X0) / BLOCK_FT);
  const row = Math.floor((GRID_Y_TOP - y) / BLOCK_FT) + 1;
  if (column < 0 || column >= LETTERS.length || row < 1) return null;
  const blockWest = GRID_X0 + column * BLOCK_FT;
  const blockSouth = GRID_Y_TOP - row * BLOCK_FT;
  const dx = x - blockWest;
  const dy = y - blockSouth;
  const east = dx >= QUARTER_FT;
  const north = dy >= QUARTER_FT;
  const quarter = north ? (east ? "B" : "A") : (east ? "D" : "C");
  const inQuarterX = dx - (east ? QUARTER_FT : 0);
  const inQuarterY = dy - (north ? QUARTER_FT : 0);
  const cellColumn = Math.floor(inQuarterX / CELL_FT);
  const cellRowFromTop = 3 - Math.floor(inQuarterY / CELL_FT);
  const cellWest = blockWest + Math.floor(dx / CELL_FT) * CELL_FT;
  const cellSouth = blockSouth + Math.floor(dy / CELL_FT) * CELL_FT;
  const quadEast = x >= cellWest + QUAD_FT;
  const quadNorth = y >= cellSouth + QUAD_FT;
  const west = cellWest + (quadEast ? QUAD_FT : 0);
  const south = cellSouth + (quadNorth ? QUAD_FT : 0);
  return {
    cell: `${LETTERS[column]}${row}${quarter}${cellRowFromTop * 4 + cellColumn + 1}`,
    quad: `${quadNorth ? "N" : "S"}${quadEast ? "E" : "W"}` as NjGridQuad["quad"],
    bounds: [west, south, west + QUAD_FT, south + QUAD_FT],
  };
}

/** Every 2025 quadrant file a State Plane box touches. */
export function njGridQuadsForBox(box: [number, number, number, number]): NjGridQuad[] {
  const [west, south, east, north] = box;
  const quads: NjGridQuad[] = [];
  const startX = Math.floor(west / QUAD_FT) * QUAD_FT;
  const startY = Math.floor(south / QUAD_FT) * QUAD_FT;
  for (let qx = startX; qx < east; qx += QUAD_FT) {
    for (let qy = startY; qy < north; qy += QUAD_FT) {
      const quad = njGridQuadAt(qx + QUAD_FT / 2, qy + QUAD_FT / 2);
      if (quad) quads.push(quad);
    }
  }
  return quads;
}

export function njQuadFileUrl(quad: NjGridQuad) {
  return `${NJ_2025_BUCKET_URL}/${quad.cell}_${quad.quad}.tif`;
}

export const TILE_SIZE = 256;

/** Longitude and latitude of a point in a Web Mercator tile, in tile units (0..1 across the tile). */
export function webMercatorToLngLat(z: number, x: number, y: number): [number, number] {
  const scale = 2 ** z;
  const lng = (x / scale) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return [lng, lat];
}

/** Native zooms the tile route renders. 19 and 20 bracket the 6-inch source. */
export const NJ_2025_MIN_NATIVE_ZOOM = 19;
export const NJ_2025_MAX_NATIVE_ZOOM = 20;

// Rough bounding box of New Jersey (with a margin), to refuse tiles elsewhere
// without touching S3.
const NJ_BOX = {west: -75.6, south: 38.9, east: -73.88, north: 41.36};

export function parseTileRequest(z: string, x: string, y: string) {
  const zoom = Number(z);
  const column = Number(x);
  const row = Number(y.replace(/\.jpg$/, ""));
  if (![zoom, column, row].every(Number.isInteger)) return null;
  if (zoom < NJ_2025_MIN_NATIVE_ZOOM || zoom > NJ_2025_MAX_NATIVE_ZOOM) return null;
  const size = 2 ** zoom;
  if (column < 0 || row < 0 || column >= size || row >= size) return null;
  const [west, north] = webMercatorToLngLat(zoom, column, row);
  const [east, south] = webMercatorToLngLat(zoom, column + 1, row + 1);
  if (east < NJ_BOX.west || west > NJ_BOX.east || north < NJ_BOX.south || south > NJ_BOX.north) return null;
  return {z: zoom, x: column, y: row};
}

// 16-bit values mapped to 8-bit display: per-band 1st and 99.5th percentiles
// of samples from 16 cells spread over the state. Fixed numbers, not per-tile
// stretching, so neighbouring tiles match.
export const NJ_2025_STRETCH = {
  low: [6136, 10706, 9408] as const,
  high: [54162, 53272, 50102] as const,
};

export function stretchToByte(value: number, band: 0 | 1 | 2) {
  const low = NJ_2025_STRETCH.low[band];
  const high = NJ_2025_STRETCH.high[band];
  const scaled = Math.round(((value - low) * 255) / (high - low));
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
}
