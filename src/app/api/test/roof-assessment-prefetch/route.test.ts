import {afterEach, describe, expect, test, vi} from "vitest";
import {DELETE, GET} from "./route";

const baseline = {...process.env};

describe("fake Place Details diagnostics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = {...baseline};
  });

  test.each([
    ["production", "development", "true"],
    ["test", "production", "true"],
    ["test", "preview", "true"],
    ["test", "development", "false"],
  ])("returns 404 for NODE_ENV=%s DEPLOYMENT_ENV=%s flag=%s", async (node, deployment, flag) => {
    vi.stubEnv("NODE_ENV", node);
    vi.stubEnv("DEPLOYMENT_ENV", deployment);
    vi.stubEnv("ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED", flag);
    expect((await GET()).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
  });

  test("allows reset and privacy-safe diagnostics only in explicit development test mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEPLOYMENT_ENV", "development");
    vi.stubEnv("ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED", "true");
    expect((await DELETE()).status).toBe(204);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({events: []});
  });
});
