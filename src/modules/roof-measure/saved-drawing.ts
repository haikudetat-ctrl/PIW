import {z} from "zod";
import {roofEdgeKinds} from "@/domain/roof-drawing";

// Shape of a saved drawing as stored in roof_measurements.drawing, checked on
// the way in (server action) and on the way out (reopening). Version 1.

export const SAVED_DRAWING_VERSION = 1;
const MAX_PLANES = 80;
const MAX_VERTICES = 60;

const latLngSchema = z.object({lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180)});

export const savedPlaneSchema = z.object({
  id: z.string().min(1).max(40),
  vertices: z.array(latLngSchema).min(3).max(MAX_VERTICES),
  pitchDegrees: z.number().min(0).max(85),
  azimuthDegrees: z.number().min(0).max(360),
  source: z.enum(["solar", "adjusted", "drawn"]),
  solarSlopedAreaSqft: z.number().nonnegative().nullable(),
  surface: z.enum(["roof", "wall"]).optional(),
  heightRef: z.object({at: latLngSchema, meters: z.number().min(-500).max(9000)}).nullable().optional(),
});

export const savedDrawingSchema = z.object({
  version: z.literal(SAVED_DRAWING_VERSION),
  planes: z.array(savedPlaneSchema).max(MAX_PLANES),
  overrides: z.record(z.string().max(120), z.enum(roofEdgeKinds)),
  pairModes: z.record(z.string().max(120), z.enum(["join", "split"])),
});
export type SavedDrawing = z.infer<typeof savedDrawingSchema>;

export const measuredInputSchema = z.object({
  source: z.string().max(40),
  totalSqft: z.number().positive().max(200_000).nullable(),
  predominantPitchRise: z.number().min(0).max(30).nullable(),
  lengthsFt: z.partialRecord(z.enum(roofEdgeKinds), z.number().nonnegative().max(100_000)),
});

export const saveRoofMeasurementInputSchema = z.object({
  id: z.uuid().nullable(),
  address: z.string().trim().min(1).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  solarBuildingName: z.string().max(200).nullable(),
  solarImageryDate: z.iso.date().nullable(),
  solarResponse: z.record(z.string(), z.unknown()).nullable(),
  drawing: savedDrawingSchema,
  measured: measuredInputSchema.nullable(),
  stories: z.enum(["one", "two", "three_plus", "unknown"]),
  wastePercent: z.number().min(0).max(50),
  totalSlopedSqft: z.number().nonnegative().max(1_000_000),
  squares: z.number().nonnegative().max(10_000),
  predominantPitchRise: z.number().int().min(0).max(30).nullable(),
  lengthsFt: z.record(z.enum(roofEdgeKinds), z.number().nonnegative()),
  jobJnid: z.string().trim().min(1).max(80).nullable(),
});
export type SaveRoofMeasurementInput = z.infer<typeof saveRoofMeasurementInputSchema>;

export type SavedMeasurementSummary = {
  id: string;
  address: string;
  squares: number;
  jobJnid: string | null;
  jobLabel: string | null;
  updatedAt: string;
};

export type SavedMeasurement = SavedMeasurementSummary & {
  latitude: number;
  longitude: number;
  solarResponse: Record<string, unknown> | null;
  drawing: SavedDrawing;
  measured: z.infer<typeof measuredInputSchema> | null;
  stories: "one" | "two" | "three_plus" | "unknown" | null;
  wastePercent: number | null;
};

export type JobOption = {jnid: string; label: string};

export function jobLabel(job: {number: string | null; address_line1: string | null; city: string | null}) {
  const place = [job.address_line1, job.city].filter(Boolean).join(", ");
  return [job.number ? `#${job.number}` : null, place || null].filter(Boolean).join(" · ") || "JobNimbus job";
}
