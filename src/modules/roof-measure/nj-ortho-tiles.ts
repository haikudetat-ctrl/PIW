import "server-only";
import {fromUrl, type GeoTIFFImage} from "geotiff";
import jpeg from "jpeg-js";
import proj4 from "proj4";
import {
  njGridQuadsForBox,
  njQuadFileUrl,
  stretchToByte,
  TILE_SIZE,
  webMercatorToLngLat,
  type NjGridQuad,
} from "./nj-ortho";

// Renders one 256 px Web Mercator tile from the NJ 2025 orthoimagery COGs.
// Each call range-reads only the pixels it needs (about 0.2 to 1 MB) from the
// state's public bucket; the route in front of it marks tiles immutable so the
// CDN serves repeats. Nothing is stored by PIW.
//
// Datum: the files are NAD83(2011); the map is WGS 84. The two differ by about
// a metre in NJ. Like the state's own 2020 web tiles, no datum shift is
// applied: a check against Google Solar's building box at a Vineland roof was
// inconclusive within that metre, and measurements are relative to the image.

proj4.defs(
  "EPSG:6527",
  "+proj=tmerc +lat_0=38.8333333333333 +lon_0=-74.5 +k=0.9999 +x_0=150000 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs",
);
const toStatePlane = proj4("EPSG:4326", "EPSG:6527");

const PIXEL_FT = 0.5;
const JPEG_QUALITY = 85;

export type CogImage = Pick<GeoTIFFImage, "getOrigin" | "getResolution" | "getWidth" | "getHeight" | "readRasters">;
/** Opens a COG, or resolves null when the file does not exist. */
export type CogOpener = (url: string) => Promise<CogImage | null>;

export class ImageryUnavailableError extends Error {}

const openCache = new Map<string, Promise<CogImage | null>>();
const OPEN_CACHE_LIMIT = 24;

/** Opens the state's COGs over HTTP range requests, keeping a few headers warm per server instance. */
export const openStateCog: CogOpener = (url) => {
  const hit = openCache.get(url);
  if (hit) {
    openCache.delete(url);
    openCache.set(url, hit);
    return hit;
  }
  const opening = (async () => {
    try {
      const tiff = await fromUrl(url, {cacheSize: 16, blockSize: 65_536});
      return (await tiff.getImage()) as CogImage;
    } catch (error) {
      // S3 answers 403/404 for a missing key: no imagery for that quadrant.
      const message = error instanceof Error ? error.message : String(error);
      if (/\b(403|404)\b/.test(message)) return null;
      throw new ImageryUnavailableError(`NJ imagery request failed: ${message}`);
    }
  })();
  opening.catch(() => openCache.delete(url));
  openCache.set(url, opening);
  while (openCache.size > OPEN_CACHE_LIMIT) {
    const oldest = openCache.keys().next().value;
    if (oldest === undefined) break;
    openCache.delete(oldest);
  }
  return opening;
};

type Patch = {quad: NjGridQuad; west: number; north: number; width: number; height: number; bands: ArrayLike<number>[]};

/** State Plane positions (feet) of every output pixel centre, row by row. */
function pixelPositions(z: number, x: number, y: number) {
  const xs = new Float64Array(TILE_SIZE * TILE_SIZE);
  const ys = new Float64Array(TILE_SIZE * TILE_SIZE);
  for (let row = 0; row < TILE_SIZE; row++) {
    for (let col = 0; col < TILE_SIZE; col++) {
      const [lng, lat] = webMercatorToLngLat(z, x + (col + 0.5) / TILE_SIZE, y + (row + 0.5) / TILE_SIZE);
      const [px, py] = toStatePlane.forward([lng, lat]);
      xs[row * TILE_SIZE + col] = px;
      ys[row * TILE_SIZE + col] = py;
    }
  }
  return {xs, ys};
}

async function readPatch(open: CogOpener, quad: NjGridQuad, box: [number, number, number, number]): Promise<Patch | null> {
  const image = await open(njQuadFileUrl(quad));
  if (!image) return null;
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const width = image.getWidth();
  const height = image.getHeight();
  // One pixel of margin for bilinear sampling across the window edge.
  const left = Math.max(0, Math.floor((box[0] - originX) / resX) - 1);
  const right = Math.min(width, Math.ceil((box[2] - originX) / resX) + 1);
  const top = Math.max(0, Math.floor((originY - box[3]) / -resY) - 1);
  const bottom = Math.min(height, Math.ceil((originY - box[1]) / -resY) + 1);
  if (right <= left || bottom <= top) return null;
  const rasters = await image.readRasters({window: [left, top, right, bottom], samples: [0, 1, 2]});
  const bands = [rasters[0], rasters[1], rasters[2]] as ArrayLike<number>[];
  return {quad, west: originX + left * resX, north: originY + top * resY, width: right - left, height: bottom - top, bands};
}

function sample(patch: Patch, px: number, py: number, band: 0 | 1 | 2) {
  // Fractional column/row measured between pixel centres.
  const fx = (px - patch.west) / PIXEL_FT - 0.5;
  const fy = (patch.north - py) / PIXEL_FT - 0.5;
  const c0 = Math.max(0, Math.min(patch.width - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(patch.height - 1, Math.floor(fy)));
  const c1 = Math.min(patch.width - 1, c0 + 1);
  const r1 = Math.min(patch.height - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const values = patch.bands[band];
  const top = values[r0 * patch.width + c0] * (1 - tx) + values[r0 * patch.width + c1] * tx;
  const bottom = values[r1 * patch.width + c0] * (1 - tx) + values[r1 * patch.width + c1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * The tile as a JPEG, or null when the state has no 2025 imagery there.
 * Throws ImageryUnavailableError when the bucket could not be read.
 */
export async function renderNj2025Tile(tile: {z: number; x: number; y: number}, open: CogOpener = openStateCog) {
  const {xs, ys} = pixelPositions(tile.z, tile.x, tile.y);
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    west = Math.min(west, xs[i]);
    east = Math.max(east, xs[i]);
    south = Math.min(south, ys[i]);
    north = Math.max(north, ys[i]);
  }
  const box: [number, number, number, number] = [west, south, east, north];
  const patches = (await Promise.all(njGridQuadsForBox(box).map((quad) => readPatch(open, quad, box))))
    .filter((patch): patch is Patch => patch !== null);
  if (patches.length === 0) return null;

  const rgba = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  let covered = 0;
  for (let i = 0; i < xs.length; i++) {
    const px = xs[i];
    const py = ys[i];
    const patch = patches.find((item) => px >= item.quad.bounds[0] && px < item.quad.bounds[2] && py >= item.quad.bounds[1] && py < item.quad.bounds[3]);
    rgba[i * 4 + 3] = 255;
    if (!patch) continue;
    covered++;
    rgba[i * 4] = stretchToByte(sample(patch, px, py, 0), 0);
    rgba[i * 4 + 1] = stretchToByte(sample(patch, px, py, 1), 1);
    rgba[i * 4 + 2] = stretchToByte(sample(patch, px, py, 2), 2);
  }
  if (covered === 0) return null;
  return jpeg.encode({data: rgba, width: TILE_SIZE, height: TILE_SIZE}, JPEG_QUALITY).data;
}
