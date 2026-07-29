import { afterEach, describe, expect, test, vi } from "vitest";
import {
  njginParcelLookupProvider,
  parseNjginParcelResponse,
} from "./njgin-parcel-lookup";

function feature(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    properties: {
      PCLBLOCK: "101",
      PCLLOT: "5",
      PCLQCODE: null,
      PAMS_PIN: "0101_5_",
      GIS_PIN: "0101-5-",
      PCL_MUN: "0101",
      MUN_NAME: "TRENTON CITY",
      COUNTY: "MERCER",
      PROP_CLASS: "2",
      OWNER_NAME: "JANE DOE",
      OWNER_ADDRESS: "12 PRIVATE LANE",
      CALC_ACRE: 0.25,
      YR_CONSTR: 1975,
      LAND_VAL: 50000,
      IMPRVT_VAL: 150000,
      NET_VALUE: 200000,
      PROP_LOC: "12 BIRCH ST",
      ST_ADDRESS: "12 BIRCH ST",
      BLDG_DESC: null,
      LAND_DESC: null,
      DWELL: 1,
      ...overrides,
    },
  };
}

describe("parseNjginParcelResponse", () => {
  test("maps a parcel feature while removing owner-shaped source fields", () => {
    const candidates = parseNjginParcelResponse({
      type: "FeatureCollection",
      features: [feature()],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      block: "101",
      lot: "5",
      municipalityName: "TRENTON CITY",
    });
    expect(JSON.stringify(candidates)).not.toContain("JANE DOE");
    expect(JSON.stringify(candidates)).not.toContain("12 PRIVATE LANE");
    expect(JSON.stringify(candidates)).not.toMatch(/owner/i);
  });

  test("returns no candidates for an empty feature collection", () => {
    expect(parseNjginParcelResponse({ type: "FeatureCollection", features: [] })).toEqual([]);
  });

  test("returns every valid feature when a lookup has multiple parcel candidates", () => {
    const candidates = parseNjginParcelResponse({
      type: "FeatureCollection",
      features: [feature(), feature({ PCLQCODE: "C0002" })],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toMatchObject({ qualifier: "C0002" });
  });

  test("retains a valid multipart parcel geometry", () => {
    const multipartParcel = {
      ...feature(),
      geometry: {
        type: "MultiPolygon",
        coordinates: [[[[0, 0], [0, 1], [1, 1], [0, 0]]]],
      },
    };

    const candidates = parseNjginParcelResponse({
      type: "FeatureCollection",
      features: [multipartParcel],
    });

    expect(candidates[0].geometry?.type).toBe("MultiPolygon");
  });

  test("rejects malformed GeoJSON with a safe error that omits owner data", () => {
    let error: unknown;

    try {
      parseNjginParcelResponse({
        type: "FeatureCollection",
        features: [feature({ PCLBLOCK: { OWNER_NAME: "PRIVATE PERSON" } })],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe("Error: NJGIN parcel response contained an invalid parcel");
    expect(String(error)).not.toMatch(/owner|private person/i);
  });

  test("rejects a payload that is not a feature collection", () => {
    expect(() => parseNjginParcelResponse({ features: [] })).toThrow(
      "NJGIN parcel response is invalid",
    );
  });

  test("rejects non-polygon or malformed polygon geometry without exposing source fields", () => {
    const malformedGeometry = {
      ...feature(),
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    };

    expect(() =>
      parseNjginParcelResponse({ type: "FeatureCollection", features: [malformedGeometry] }),
    ).toThrow("NJGIN parcel response contained an invalid parcel");
  });

  test("rejects a polygon whose ring is not closed", () => {
    const unclosedPolygon = {
      ...feature(),
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0]]] },
    };

    expect(() =>
      parseNjginParcelResponse({ type: "FeatureCollection", features: [unclosedPolygon] }),
    ).toThrow("NJGIN parcel response contained an invalid parcel");
  });
});

describe("njginParcelLookupProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("queries the FeatureServer by point and returns parsed candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [feature()] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await njginParcelLookupProvider.execute(
      { lat: 40.22, lng: -74.76 },
      {
        companyId: "company-1",
        pipelineRunId: "run-1",
        correlationId: "corr-1",
        requestKey: "parcel.lookup:run-1",
        deploymentEnvironment: "test",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query",
      ),
    );
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).not.toHaveProperty("ownerName");
    expect(result.estimatedCostMicros).toBe(0);
  });
});
