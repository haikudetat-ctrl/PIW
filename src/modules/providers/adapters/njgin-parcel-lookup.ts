import "server-only";
import { parcelDataSchema, type ParcelData } from "@/domain/property-identity";
import type { ProviderAdapter, ProviderResult } from "../contracts";

const NJGIN_QUERY_URL =
  "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query";

// Request only the attributes that can enter ParcelData. In particular, no
// owner-shaped attribute is requested from the FeatureServer.
const NJGIN_PARCEL_FIELDS = [
  "PCLBLOCK",
  "PCLLOT",
  "PCLQCODE",
  "PAMS_PIN",
  "GIS_PIN",
  "PCL_MUN",
  "MUN_NAME",
  "COUNTY",
  "PROP_CLASS",
  "CALC_ACRE",
  "YR_CONSTR",
  "LAND_VAL",
  "IMPRVT_VAL",
  "NET_VALUE",
  "PROP_LOC",
  "ST_ADDRESS",
  "BLDG_DESC",
  "LAND_DESC",
  "DWELL",
].join(",");

type NjginLookupInput = { lat: number; lng: number } | { address: string };
type PolygonCoordinates = number[][][];
type MultiPolygonCoordinates = PolygonCoordinates[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("invalid value");
}

function toRequiredString(value: unknown): string {
  const parsed = toNullableString(value);
  if (parsed === null || parsed.length === 0) throw new Error("invalid value");
  return parsed;
}

function toNullableQualifier(value: unknown): string | null {
  const parsed = toNullableString(value)?.trim();
  return parsed ? parsed : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid value");

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid value");
  return parsed;
}

function sanitizePosition(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
  ) {
    throw new Error("invalid geometry");
  }

  return [...value];
}

function samePosition(first: number[], last: number[]): boolean {
  return first.length === last.length && first.every((coordinate, index) => coordinate === last[index]);
}

function sanitizePolygonCoordinates(value: unknown): PolygonCoordinates {
  if (!Array.isArray(value) || value.length === 0) throw new Error("invalid geometry");

  return value.map((rawRing) => {
    if (!Array.isArray(rawRing) || rawRing.length < 4) throw new Error("invalid geometry");

    const ring = rawRing.map(sanitizePosition);
    if (!samePosition(ring[0], ring[ring.length - 1])) throw new Error("invalid geometry");
    return ring;
  });
}

function sanitizeMultiPolygonCoordinates(value: unknown): MultiPolygonCoordinates {
  if (!Array.isArray(value) || value.length === 0) throw new Error("invalid geometry");
  return value.map(sanitizePolygonCoordinates);
}

function sanitizeGeometry(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  if (!isRecord(value) || !("coordinates" in value)) {
    throw new Error("invalid geometry");
  }

  if (value.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: sanitizePolygonCoordinates(value.coordinates),
    };
  }

  if (value.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: sanitizeMultiPolygonCoordinates(value.coordinates),
    };
  }

  throw new Error("invalid geometry");
}

function parseFeature(rawFeature: unknown): ParcelData {
  if (!isRecord(rawFeature) || !isRecord(rawFeature.properties)) {
    throw new Error("invalid feature");
  }

  const properties = rawFeature.properties;
  const parsedParcel = parcelDataSchema.safeParse({
    block: toRequiredString(properties.PCLBLOCK),
    lot: toRequiredString(properties.PCLLOT),
    qualifier: toNullableQualifier(properties.PCLQCODE),
    pamsPin: toNullableString(properties.PAMS_PIN),
    gisPin: toNullableString(properties.GIS_PIN),
    municipalityCode: toNullableString(properties.PCL_MUN),
    municipalityName: toNullableString(properties.MUN_NAME),
    county: toNullableString(properties.COUNTY),
    propertyClass: toNullableString(properties.PROP_CLASS),
    acreage: toNullableNumber(properties.CALC_ACRE),
    yearBuilt: toNullableNumber(properties.YR_CONSTR),
    landValue: toNullableNumber(properties.LAND_VAL),
    improvementValue: toNullableNumber(properties.IMPRVT_VAL),
    netValue: toNullableNumber(properties.NET_VALUE),
    propertyLocation: toNullableString(properties.PROP_LOC),
    streetAddress: toNullableString(properties.ST_ADDRESS),
    buildingDescription: toNullableString(properties.BLDG_DESC),
    landDescription: toNullableString(properties.LAND_DESC),
    dwellingUnits: toNullableNumber(properties.DWELL),
    geometry: sanitizeGeometry(rawFeature.geometry),
  });

  if (!parsedParcel.success) throw new Error("invalid parcel");
  return parsedParcel.data;
}

export function parseNjginParcelResponse(raw: unknown): ParcelData[] {
  if (!isRecord(raw) || raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    throw new Error("NJGIN parcel response is invalid");
  }

  return raw.features.map((feature) => {
    try {
      return parseFeature(feature);
    } catch {
      // Do not let schema errors or untrusted GeoJSON properties expose data
      // that was deliberately excluded from the property domain model.
      throw new Error("NJGIN parcel response contained an invalid parcel");
    }
  });
}

function buildWhereClause(input: NjginLookupInput): string {
  if ("address" in input) {
    const escaped = input.address.replace(/'/g, "''").toUpperCase();
    return `PROP_LOC LIKE '%${escaped}%' OR ST_ADDRESS LIKE '%${escaped}%'`;
  }

  return "1=1";
}

async function fetchNjginParcels(input: NjginLookupInput): Promise<unknown> {
  const url = new URL(NJGIN_QUERY_URL);
  url.searchParams.set("outFields", NJGIN_PARCEL_FIELDS);
  url.searchParams.set("f", "geojson");
  url.searchParams.set("where", buildWhereClause(input));

  if ("lat" in input) {
    url.searchParams.set("geometry", `${input.lng},${input.lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  }

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    throw new Error("NJGIN parcel request failed");
  }

  if (!response.ok) throw new Error(`NJGIN parcel query responded with ${response.status}`);

  try {
    return await response.json();
  } catch {
    throw new Error("NJGIN parcel response is invalid");
  }
}

export const njginParcelLookupProvider: ProviderAdapter<NjginLookupInput, ParcelData[]> = {
  id: "njgin-parcel-lookup",
  capability: "parcel.lookup",
  priority: 10,
  paid: false,
  enabled: true,
  async execute(input: NjginLookupInput): Promise<ProviderResult<ParcelData[]>> {
    const value = parseNjginParcelResponse(await fetchNjginParcels(input));
    const first = value[0];

    return {
      value,
      provider: "njgin_parcels_composite",
      sourceIdentifier: first ? `${first.municipalityCode}-${first.block}-${first.lot}` : "no-match",
      retrievedAt: new Date().toISOString(),
      estimatedCostMicros: 0,
    };
  },
};
