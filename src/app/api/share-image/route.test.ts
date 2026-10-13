// @vitest-environment node
import {expect, it} from "vitest";
import {GET} from "./route";

it("serves a public PNG for link previews", async () => {
  const response = GET();
  expect(response.headers.get("content-type")).toBe("image/png");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer);
  expect(header.getUint32(16)).toBe(1200);
  expect(header.getUint32(20)).toBe(630);
});
