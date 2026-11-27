import {beforeEach, describe, expect, test, vi} from "vitest";
import {GET} from "./route";

const auth = vi.hoisted(() => ({user: null as {id: string} | null, role: "manager" as string | null}));
const render = vi.hoisted(() => ({fn: vi.fn()}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {getUser: async () => ({data: {user: auth.user}})},
    rpc: async () => ({
      data: auth.role ? [{user_id: "u1", company_id: "c1", display_name: "Chris", role: auth.role, is_platform_admin: false}] : [],
    }),
  }),
}));
vi.mock("@/modules/roof-measure/nj-ortho-tiles", () => ({
  ImageryUnavailableError: class extends Error {},
  renderNj2025Tile: render.fn,
}));

const call = (z: string, x: string, y: string) => GET(new Request("https://rake.test/api"), {params: Promise.resolve({z, x, y})});

beforeEach(() => {
  auth.user = {id: "u1"};
  auth.role = "manager";
  render.fn.mockReset();
});

describe("NJ 2025 tile route", () => {
  test("serves a rendered tile as an immutable JPEG", async () => {
    render.fn.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    const response = await call("20", "306021", "399111.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(render.fn).toHaveBeenCalledWith({z: 20, x: 306021, y: 399111});
  });

  test("404s outside the rendered zooms or New Jersey without rendering", async () => {
    expect((await call("17", "38252", "49888.jpg")).status).toBe(404);
    expect((await call("20", "250000", "400000.jpg")).status).toBe(404);
    expect(render.fn).not.toHaveBeenCalled();
  });

  test("404s where the state has no imagery", async () => {
    render.fn.mockResolvedValue(null);
    expect((await call("20", "306021", "399111.jpg")).status).toBe(404);
  });

  test("needs a signed-in CRM user to render", async () => {
    auth.user = null;
    expect((await call("20", "306021", "399111.jpg")).status).toBe(401);
    auth.user = {id: "u1"};
    auth.role = null;
    expect((await call("20", "306021", "399111.jpg")).status).toBe(403);
    expect(render.fn).not.toHaveBeenCalled();
  });

  test("does not cache a failed render", async () => {
    render.fn.mockRejectedValue(new Error("boom"));
    const response = await call("20", "306021", "399111.jpg");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
