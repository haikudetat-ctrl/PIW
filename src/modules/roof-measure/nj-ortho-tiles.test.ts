import jpeg from "jpeg-js";
import {describe, expect, test, vi} from "vitest";
import {ImageryUnavailableError, renderNj2025Tile, type CogImage, type CogOpener} from "./nj-ortho-tiles";

vi.mock("server-only", () => ({}));

// A fake 2,500 ft quadrant file: 5,000 px at 0.5 ft, red rising west to east,
// green fixed, blue rising north to south.
function fakeQuad(west: number, north: number): CogImage {
  const size = 5000;
  return {
    getOrigin: () => [west, north, 0],
    getResolution: () => [0.5, -0.5, 0],
    getWidth: () => size,
    getHeight: () => size,
    readRasters: (async ({window}: {window: [number, number, number, number]}) => {
      const [left, top, right, bottom] = window;
      const width = right - left;
      const height = bottom - top;
      const bands = [new Uint16Array(width * height), new Uint16Array(width * height), new Uint16Array(width * height)];
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          bands[0][row * width + col] = 6136 + ((left + col) / size) * 48000;
          bands[1][row * width + col] = 30000;
          bands[2][row * width + col] = 9408 + ((top + row) / size) * 40000;
        }
      }
      return bands;
    }) as unknown as CogImage["readRasters"],
  };
}

// The zoom 20 tile over the Vineland test roof sits inside quadrant E18C8_NE
// (x 367,500 to 370,000 ft, y 217,500 to 220,000 ft).
const VINELAND_TILE = {z: 20, x: 306021, y: 399111};

describe("NJ 2025 tile rendering", () => {
  test("renders a JPEG from the quadrant file under the tile", async () => {
    const open = vi.fn<CogOpener>(async (url) => (url.endsWith("E18C8_NE.tif") ? fakeQuad(367500, 220000) : null));
    const body = await renderNj2025Tile(VINELAND_TILE, open);
    expect(body).not.toBeNull();
    const image = jpeg.decode(body!, {useTArray: true});
    expect(image.width).toBe(256);
    expect(image.height).toBe(256);
    const at = (col: number, row: number) => Array.from(image.data.slice((row * 256 + col) * 4, (row * 256 + col) * 4 + 3));
    // Red rises to the east and blue to the south, as in the source.
    expect(at(250, 128)[0]).toBeGreaterThan(at(5, 128)[0]);
    expect(at(128, 250)[2]).toBeGreaterThan(at(128, 5)[2]);
    expect(open).toHaveBeenCalledWith("https://njogis-imagery.s3.amazonaws.com/2025/cog/E18C8_NE.tif");
  });

  test("returns null where the state has no file", async () => {
    expect(await renderNj2025Tile(VINELAND_TILE, async () => null)).toBeNull();
  });

  test("passes on a failed bucket read", async () => {
    await expect(renderNj2025Tile(VINELAND_TILE, async () => {
      throw new ImageryUnavailableError("down");
    })).rejects.toThrow(ImageryUnavailableError);
  });
});
