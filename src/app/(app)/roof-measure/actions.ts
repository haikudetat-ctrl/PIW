"use server";

import type {Json} from "@/lib/database.types";
import {createServerClient} from "@/lib/supabase/server";
import {
  jobLabel,
  measuredInputSchema,
  saveRoofMeasurementInputSchema,
  savedDrawingSchema,
  type JobOption,
  type SavedMeasurement,
  type SavedMeasurementSummary,
} from "@/modules/roof-measure/saved-drawing";

// Server actions for the staff measuring page. Every query runs as the signed-in
// user, so roof_measurements RLS (Managers and above, own company) decides
// what is visible and writable.

type Result<T> = {ok: true; value: T} | {ok: false; error: string};

const MISSING_TABLE = "42P01";

function failure(error: {code?: string; message?: string} | null, fallback: string): {ok: false; error: string} {
  if (error?.code === MISSING_TABLE) {
    return {ok: false, error: "Saving isn't switched on yet: the roof_measurements table hasn't been added to the database."};
  }
  if (error?.code === "42501") return {ok: false, error: "You don't have access to save that drawing (or that job)."};
  return {ok: false, error: fallback};
}

async function signedIn() {
  const supabase = await createServerClient();
  const {data: {user}} = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function saveRoofMeasurement(raw: unknown): Promise<Result<{id: string}>> {
  const parsed = saveRoofMeasurementInputSchema.safeParse(raw);
  if (!parsed.success) return {ok: false, error: "The drawing didn't pass checks, so it wasn't saved."};
  const supabase = await signedIn();
  if (!supabase) return {ok: false, error: "Sign in again to save."};
  const input = parsed.data;
  const row = {
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    solar_building_name: input.solarBuildingName,
    solar_imagery_date: input.solarImageryDate,
    solar_response: input.solarResponse as Json | null,
    drawing: input.drawing as unknown as Json,
    measured: input.measured as Json | null,
    stories: input.stories,
    waste_percent: input.wastePercent,
    total_sloped_sqft: Math.round(input.totalSlopedSqft * 100) / 100,
    squares: Math.round(input.squares * 100) / 100,
    predominant_pitch_rise: input.predominantPitchRise,
    lengths_ft: input.lengthsFt as Json,
    job_jnid: input.jobJnid,
  };
  const query = input.id
    ? supabase.from("roof_measurements").update(row).eq("id", input.id).select("id").maybeSingle()
    : supabase.from("roof_measurements").insert(row).select("id").single();
  const {data, error} = await query;
  if (error || !data) return failure(error, "The drawing couldn't be saved.");
  return {ok: true, value: {id: data.id}};
}

async function jobLabels(supabase: NonNullable<Awaited<ReturnType<typeof signedIn>>>, jnids: string[]) {
  if (jnids.length === 0) return new Map<string, string>();
  const {data} = await supabase.from("jn_jobs").select("jnid, number, address_line1, city").in("jnid", jnids);
  return new Map((data ?? []).map((job) => [job.jnid, jobLabel(job)]));
}

export async function listRoofMeasurements(): Promise<Result<SavedMeasurementSummary[]>> {
  const supabase = await signedIn();
  if (!supabase) return {ok: false, error: "Sign in again to see saved drawings."};
  const {data, error} = await supabase
    .from("roof_measurements")
    .select("id, address, squares, job_jnid, updated_at")
    .order("updated_at", {ascending: false})
    .limit(25);
  if (error) return failure(error, "Saved drawings couldn't be loaded.");
  const labels = await jobLabels(supabase, [...new Set(data.map((row) => row.job_jnid).filter((v): v is string => Boolean(v)))]);
  return {
    ok: true,
    value: data.map((row) => ({
      id: row.id,
      address: row.address,
      squares: Number(row.squares),
      jobJnid: row.job_jnid,
      jobLabel: row.job_jnid ? labels.get(row.job_jnid) ?? null : null,
      updatedAt: row.updated_at,
    })),
  };
}

export async function getRoofMeasurement(id: string): Promise<Result<SavedMeasurement>> {
  const supabase = await signedIn();
  if (!supabase) return {ok: false, error: "Sign in again to open saved drawings."};
  const {data, error} = await supabase
    .from("roof_measurements")
    .select("id, address, latitude, longitude, squares, job_jnid, updated_at, solar_response, drawing, measured, stories, waste_percent")
    .eq("id", id)
    .maybeSingle();
  if (error) return failure(error, "That drawing couldn't be opened.");
  if (!data) return {ok: false, error: "That drawing doesn't exist or isn't yours to open."};
  const drawing = savedDrawingSchema.safeParse(data.drawing);
  if (!drawing.success) return {ok: false, error: "That drawing was saved in a shape this page can't read."};
  const measured = data.measured ? measuredInputSchema.safeParse(data.measured) : null;
  const labels = await jobLabels(supabase, data.job_jnid ? [data.job_jnid] : []);
  return {
    ok: true,
    value: {
      id: data.id,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      squares: Number(data.squares),
      jobJnid: data.job_jnid,
      jobLabel: data.job_jnid ? labels.get(data.job_jnid) ?? null : null,
      updatedAt: data.updated_at,
      solarResponse: data.solar_response && typeof data.solar_response === "object" && !Array.isArray(data.solar_response)
        ? data.solar_response as Record<string, unknown>
        : null,
      drawing: drawing.data,
      measured: measured?.success ? measured.data : null,
      stories: (data.stories as SavedMeasurement["stories"]) ?? null,
      wastePercent: data.waste_percent === null ? null : Number(data.waste_percent),
    },
  };
}

export async function searchJobs(query: string): Promise<Result<JobOption[]>> {
  const term = query.trim().replace(/[%_,()]/g, " ").trim();
  if (term.length < 2) return {ok: true, value: []};
  const supabase = await signedIn();
  if (!supabase) return {ok: false, error: "Sign in again to search jobs."};
  const {data, error} = await supabase
    .from("jn_jobs")
    .select("jnid, number, address_line1, city")
    .or(`address_line1.ilike.%${term}%,number.ilike.%${term}%`)
    .order("jn_updated_at", {ascending: false, nullsFirst: false})
    .limit(8);
  if (error) return {ok: false, error: "Jobs couldn't be searched."};
  return {ok: true, value: data.map((job) => ({jnid: job.jnid, label: jobLabel(job)}))};
}
