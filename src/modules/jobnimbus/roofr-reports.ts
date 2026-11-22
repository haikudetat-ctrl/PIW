import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import type { Database, Json } from "@/lib/database.types";
import type { JobNimbusFileDownload, JobNimbusTelemetry } from "./client";

// Roofr measurement reports attached to JobNimbus jobs are the measured roof:
// what a Google Solar estimate is checked against. Parsing and extraction are
// ported from 2stack-roof-quote, where they were proven against the All Season
// account's real reports. Reports are found by content, not by name: most are
// saved under the property address, so every candidate file is read and only
// text that Roofr prepared is parsed.

const SQUARE_FEET_PER_SQUARE = 100;
const MAX_REPORT_BYTES = 25 * 1024 * 1024;
const MAX_REPORT_PAGES = 100;
const EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_AREA_SQFT = 99_999_999;
const MAX_PITCH_12 = 100;
const MAX_FACETS = 10_000;
const MAX_WASTE_PERCENT = 1_000;
const MAX_EDGE_FEET = 999_999;
const DEFAULT_REPORTS_PER_RUN = 20;

export type RoofrReportErrorCode =
  | "non_pdf"
  | "corrupt_pdf"
  | "invalid_report"
  | "outbuilding"
  | "invalid_candidate"
  | "provider_terminal"
  | "not_roofr";

export class RoofrReportError extends Error {
  readonly terminal = true;
  readonly code: RoofrReportErrorCode;

  constructor(code: RoofrReportErrorCode, options?: { cause?: unknown }) {
    super(`Roofr report ${code.replaceAll("_", " ")}`, options);
    this.name = "RoofrReportError";
    this.code = code;
  }
}

export type RoofrPitchArea = { pitch12: number; areaSqft: number };

export type RoofrMeasurement = {
  totalSquares: number;
  predominantPitch12: number | null;
  facets: number | null;
  twoLayerSquares: number | null;
  twoStorySquares: number | null;
  flatSquares: number | null;
  pitchArea: RoofrPitchArea[];
  areaWeightedPitch12: number | null;
  maxPitch12: number | null;
  wasteLadder: number[];
  edgesFt: RoofrEdges;
};

// Linear footage in feet; null when the report has no such line.
export type RoofrEdges = {
  eaves: number | null;
  rakes: number | null;
  ridges: number | null;
  hips: number | null;
  valleys: number | null;
  wallFlashing: number | null;
  stepFlashing: number | null;
};

const EDGE_LABELS: Record<keyof RoofrEdges, string> = {
  eaves: "eaves",
  rakes: "rakes",
  ridges: "ridges",
  hips: "hips",
  valleys: "valleys",
  wallFlashing: "wall flashing",
  stepFlashing: "step flashing",
};

// Text that Roofr did not prepare is some other PDF of the same shape.
export function assertRoofrPrepared(text: string): void {
  if (!/\bRoofr\b/i.test(text)) {
    throw new RoofrReportError("not_roofr");
  }
}

export function parseRoofrText(text: string): RoofrMeasurement {
  if (typeof text !== "string" || text.length === 0) {
    throw new RoofrReportError("invalid_report");
  }

  const totalSqft = requiredNumber(
    firstCapture(text, /Total roof area:?\s*([^\s]+)\s*sqft/i),
    MAX_AREA_SQFT,
  );
  if (totalSqft / SQUARE_FEET_PER_SQUARE < 6) {
    throw new RoofrReportError("outbuilding");
  }

  const predominantPitch12 = optionalNumberCapture(text, /Predominant pitch:?\s*([^\s/]+)\s*\/\s*12/i, MAX_PITCH_12);
  const facets = optionalNumberCapture(text, /Total roof facets:?\s*([^\s]+)/i, MAX_FACETS);
  const twoLayerSqft = optionalNumberCapture(text, /Two layer area:?\s*([^\s]+)\s*sqft/i, MAX_AREA_SQFT);
  const twoStorySqft = optionalNumberCapture(text, /Two story area:?\s*([^\s]+)\s*sqft/i, MAX_AREA_SQFT);
  const flatSqft = optionalNumberCapture(text, /Flat roof area:?\s*([^\s]+)\s*sqft/i, MAX_AREA_SQFT);

  const pitchTokens = firstCapture(
    text,
    /Pitch\s+((?:(?:[1-9]\d{0,2}(?:,\d{3})+|0|[1-9]\d*)\s*\/\s*12\s*)+)/i,
  );
  const areaTokens = firstCapture(
    text,
    /Area\s*\(sqft\)\s+((?:(?:[1-9]\d{0,2}(?:,\d{3})+|0|[1-9]\d*)\s*)+)/i,
  );
  const pitches = pitchTokens === null
    ? []
    : [...pitchTokens.matchAll(/([^\s/]+)\s*\/\s*12/g)].map((match) => strictNumber(match[1], MAX_PITCH_12));
  const areas = areaTokens === null
    ? []
    : areaTokens.trim().split(/\s+/).map((token) => strictNumber(token, MAX_AREA_SQFT));
  const pairedPitchCount = Math.min(pitches.length, areas.length);
  const pitchArea = Array.from({ length: pairedPitchCount }, (_, index) => ({
    pitch12: pitches[index],
    areaSqft: areas[index],
  }));
  const pitchAreaTotal = pitchArea.reduce((sum, row) => sum + row.areaSqft, 0);
  const areaWeightedPitch12 = pitchAreaTotal > 0
    ? round(pitchArea.reduce((sum, row) => sum + row.pitch12 * row.areaSqft, 0) / pitchAreaTotal, 2)
    : null;

  const wasteTokens = firstCapture(
    text,
    /Pitched area\s*\(sqft\)\s+((?:(?:[1-9]\d{0,2}(?:,\d{3})+|0|[1-9]\d*)\s*)+)/i,
  );
  const wasteAreas = wasteTokens === null
    ? []
    : wasteTokens.trim().split(/\s+/).map((token) => strictNumber(token, MAX_AREA_SQFT));
  const wasteLadder = wasteAreas.length >= 2 && wasteAreas[0] > 0
    ? wasteAreas.map((value) => round((value / wasteAreas[0] - 1) * 100, 1))
    : [];
  if (wasteLadder.some((value) => value < 0 || value > MAX_WASTE_PERCENT)) {
    throw new RoofrReportError("invalid_report");
  }

  return {
    totalSquares: round(totalSqft / SQUARE_FEET_PER_SQUARE, 2),
    predominantPitch12,
    facets,
    twoLayerSquares: squares(twoLayerSqft),
    twoStorySquares: squares(twoStorySqft),
    flatSquares: squares(flatSqft),
    pitchArea,
    areaWeightedPitch12,
    maxPitch12: pitchArea.length > 0 ? Math.max(...pitchArea.map((row) => row.pitch12)) : null,
    wasteLadder,
    edgesFt: parseEdges(text),
  };
}

// The report summary lists "Total eaves 443ft 9in"; the length page lists
// "Eaves: 443ft 9in". Either is read, summary first.
function parseEdges(text: string): RoofrEdges {
  const edges = {} as RoofrEdges;
  for (const [key, label] of Object.entries(EDGE_LABELS) as [keyof RoofrEdges, string][]) {
    const words = label.replace(" ", "\\s+");
    const feet = new RegExp(`Total\\s+${words}\\s+([^\\s]+?)\\s*ft\\s*(\\d+)\\s*in`, "i").exec(text)
      ?? new RegExp(`\\b${words}:\\s*([^\\s]+?)\\s*ft\\s*(\\d+)\\s*in`, "i").exec(text);
    edges[key] = feet === null ? null : feetAndInches(feet[1], feet[2]);
  }
  return edges;
}

function feetAndInches(feetToken: string, inchToken: string): number {
  const feet = strictNumber(feetToken, MAX_EDGE_FEET);
  const inches = strictNumber(inchToken, 11);
  const value = round(feet + inches / 12, 2);
  if (value > MAX_EDGE_FEET) throw new RoofrReportError("invalid_report");
  return value;
}

export async function extractRoofrText(bytes: Uint8Array): Promise<string> {
  if (
    bytes.length < 5
    || bytes[0] !== 0x25
    || bytes[1] !== 0x50
    || bytes[2] !== 0x44
    || bytes[3] !== 0x46
    || bytes[4] !== 0x2d
  ) {
    throw new RoofrReportError("non_pdf");
  }
  if (bytes.length > MAX_REPORT_BYTES) {
    throw new RoofrReportError("corrupt_pdf");
  }

  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    document = await withTimeout(getDocumentProxy(bytes, { maxImageSize: 16_777_216 }));
    if (document.numPages < 1 || document.numPages > MAX_REPORT_PAGES) {
      throw new Error("unsupported page count");
    }
    const result = await withTimeout(extractText(document, { mergePages: true }));
    if (typeof result.text !== "string" || result.text.trim().length === 0) {
      throw new Error("empty PDF text");
    }
    return result.text;
  } catch (cause) {
    throw new RoofrReportError("corrupt_pdf", { cause });
  } finally {
    await document?.cleanup().catch(() => undefined);
  }
}

// A file that could be a Roofr report, on the job it belongs to (its own job,
// or its contact's). matchRank: 0 named like a report, 1 named after an
// address, 2 matched only by size and page count.
export type RoofrCandidate = {
  jnid: string;
  filename: string | null;
  relatedJobJnid: string | null;
  createdAt: string | null;
  matchRank: number;
};

// One file per job per run. A job can carry several Roofr reports
// (re-measures) and other PDFs of the same shape: files already read are
// skipped, files older than the job's newest ingested report are skipped
// (the newest is the measurement of record), and of the rest the likeliest
// name wins, then the newest. Likely names drain first across jobs.
export function selectRoofrCandidates(
  files: RoofrCandidate[],
  processed: ReadonlyMap<string, RoofrReportOutcome>,
): RoofrCandidate[] {
  const newestIngested = new Map<string, number>();
  for (const file of files) {
    if (file.relatedJobJnid === null || processed.get(file.jnid) !== "ingested") continue;
    const at = timestamp(file.createdAt);
    newestIngested.set(file.relatedJobJnid, Math.max(newestIngested.get(file.relatedJobJnid) ?? -Infinity, at));
  }

  const chosen = new Map<string, RoofrCandidate>();
  for (const file of files) {
    const job = file.relatedJobJnid;
    if (job === null || processed.has(file.jnid)) continue;
    const ingestedAt = newestIngested.get(job);
    if (ingestedAt !== undefined && timestamp(file.createdAt) <= ingestedAt) continue;
    const prior = chosen.get(job);
    if (prior === undefined || compareCandidate(file, prior) > 0) chosen.set(job, file);
  }
  return [...chosen.values()].sort((left, right) =>
    left.matchRank - right.matchRank || left.jnid.localeCompare(right.jnid));
}

export type RoofrReportOutcome = "ingested" | RoofrReportErrorCode;

export type RoofrReportRow = {
  companyId: string;
  fileJnid: string;
  jobJnid: string;
  outcome: RoofrReportOutcome;
  measurement: RoofrMeasurement | null;
  telemetry: JobNimbusTelemetry;
};

export type RoofrReportStore = {
  getEnvKeyName(companyId: string): Promise<string>;
  listRoofrFiles(companyId: string): Promise<RoofrCandidate[]>;
  listProcessedFiles(companyId: string): Promise<Map<string, RoofrReportOutcome>>;
  writeReport(row: RoofrReportRow): Promise<void>;
};

export type RoofrReportDependencies = {
  store: RoofrReportStore;
  createClient(apiKey: string): { downloadFile(jnid: string): Promise<JobNimbusFileDownload> };
  resolveCredential(envKeyName: string): string | undefined;
  extractText(bytes: Uint8Array): Promise<string>;
};

export type RoofrReportRunResult = {
  candidates: number;
  processed: number;
  ingested: number;
  // Transient download failures write nothing, so the next run retries them.
  retryLater: number;
  apiCalls: number;
};

// Reads the newest unprocessed Roofr report on each job, at most `limit` per
// run, serially through one paced client.
export async function runRoofrReports(
  input: { companyId: string; limit?: number },
  dependencies: RoofrReportDependencies,
): Promise<RoofrReportRunResult> {
  const [files, processed] = await Promise.all([
    dependencies.store.listRoofrFiles(input.companyId),
    dependencies.store.listProcessedFiles(input.companyId),
  ]);
  const pending = selectRoofrCandidates(files, processed);
  const batch = pending.slice(0, input.limit ?? DEFAULT_REPORTS_PER_RUN);
  const result: RoofrReportRunResult = {
    candidates: pending.length,
    processed: 0,
    ingested: 0,
    retryLater: 0,
    apiCalls: 0,
  };
  if (batch.length === 0) return result;

  const envKeyName = await dependencies.store.getEnvKeyName(input.companyId);
  const apiKey = dependencies.resolveCredential(envKeyName);
  if (!apiKey) throw new Error("Missing JobNimbus report credential");
  const client = dependencies.createClient(apiKey);

  for (const file of batch) {
    const jobJnid = file.relatedJobJnid as string;
    let download: JobNimbusFileDownload | undefined;
    let row: RoofrReportRow;
    try {
      download = await client.downloadFile(file.jnid);
      const text = await dependencies.extractText(download.bytes);
      assertRoofrPrepared(text);
      const measurement = parseRoofrText(text);
      row = {
        companyId: input.companyId,
        fileJnid: file.jnid,
        jobJnid,
        outcome: "ingested",
        measurement,
        telemetry: telemetryFrom(download),
      };
    } catch (error) {
      const outcome = error instanceof RoofrReportError
        ? error.code
        : isTerminalProviderError(error) ? "provider_terminal" : null;
      const telemetry = telemetryFrom(download ?? error);
      result.apiCalls += telemetry.apiCalls;
      if (outcome === null) {
        result.retryLater += 1;
        continue;
      }
      row = { companyId: input.companyId, fileJnid: file.jnid, jobJnid, outcome, measurement: null, telemetry };
      await dependencies.store.writeReport(row);
      result.processed += 1;
      continue;
    }
    await dependencies.store.writeReport(row);
    result.apiCalls += row.telemetry.apiCalls;
    result.processed += 1;
    result.ingested += 1;
  }
  return result;
}

export function createSupabaseRoofrReportStore(database: SupabaseClient<Database>): RoofrReportStore {
  return {
    async getEnvKeyName(companyId) {
      const { data, error } = await database
        .from("company_integrations")
        .select("env_key_name")
        .eq("company_id", companyId)
        .eq("provider", "jobnimbus")
        .eq("enabled", true)
        .maybeSingle();
      if (error || !data) throw new Error("JobNimbus report integration lookup failed", { cause: error });
      return data.env_key_name;
    },

    async listRoofrFiles(companyId) {
      const { data, error } = await database
        .from("jobnimbus_roofr_report_candidates")
        .select("file_jnid, filename, job_jnid, jn_created_at, match_rank")
        .eq("company_id", companyId);
      if (error || !data) throw new Error("Roofr report file listing failed", { cause: error });
      return data.flatMap((file) => file.file_jnid === null ? [] : [{
        jnid: file.file_jnid,
        filename: file.filename,
        relatedJobJnid: file.job_jnid,
        createdAt: file.jn_created_at,
        matchRank: file.match_rank ?? 2,
      }]);
    },

    async listProcessedFiles(companyId) {
      const { data, error } = await database
        .from("jobnimbus_roofr_reports")
        .select("file_jnid, outcome")
        .eq("company_id", companyId);
      if (error || !data) throw new Error("Roofr report outcome listing failed", { cause: error });
      return new Map(data.map((row) => [row.file_jnid, row.outcome as RoofrReportOutcome]));
    },

    async writeReport(row) {
      const measurement = row.measurement;
      const { error } = await database.from("jobnimbus_roofr_reports").upsert({
        company_id: row.companyId,
        file_jnid: row.fileJnid,
        job_jnid: row.jobJnid,
        outcome: row.outcome,
        total_squares: measurement?.totalSquares ?? null,
        predominant_pitch_12: measurement?.predominantPitch12 ?? null,
        area_weighted_pitch_12: measurement?.areaWeightedPitch12 ?? null,
        max_pitch_12: measurement?.maxPitch12 ?? null,
        facets: measurement?.facets ?? null,
        two_layer_squares: measurement?.twoLayerSquares ?? null,
        two_story_squares: measurement?.twoStorySquares ?? null,
        flat_squares: measurement?.flatSquares ?? null,
        pitch_area: (measurement?.pitchArea ?? []) as unknown as Json,
        waste_ladder: (measurement?.wasteLadder ?? []) as unknown as Json,
        eaves_ft: measurement?.edgesFt.eaves ?? null,
        rakes_ft: measurement?.edgesFt.rakes ?? null,
        ridges_ft: measurement?.edgesFt.ridges ?? null,
        hips_ft: measurement?.edgesFt.hips ?? null,
        valleys_ft: measurement?.edgesFt.valleys ?? null,
        wall_flashing_ft: measurement?.edgesFt.wallFlashing ?? null,
        step_flashing_ft: measurement?.edgesFt.stepFlashing ?? null,
        api_calls: row.telemetry.apiCalls,
        transient_error_count: row.telemetry.transientErrorCount,
        rate_limit_response_count: row.telemetry.rateLimitResponses,
        processed_at: new Date().toISOString(),
      }, { onConflict: "company_id,file_jnid" });
      if (error) throw new Error("Roofr report write failed", { cause: error });
    },
  };
}

function firstCapture(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1] ?? null;
}

function requiredNumber(token: string | null, maximum: number): number {
  if (token === null) throw new RoofrReportError("invalid_report");
  return strictNumber(token, maximum);
}

function optionalNumberCapture(text: string, pattern: RegExp, maximum: number): number | null {
  const token = firstCapture(text, pattern);
  return token === null ? null : strictNumber(token, maximum);
}

function strictNumber(token: string, maximum: number): number {
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(token)) {
    throw new RoofrReportError("invalid_report");
  }
  const value = Number(token.replaceAll(",", ""));
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RoofrReportError("invalid_report");
  }
  return value;
}

function squares(value: number | null): number | null {
  return value === null ? null : round(value / SQUARE_FEET_PER_SQUARE, 2);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function timestamp(value: string | null): number {
  return Date.parse(value ?? "") || 0;
}

// Positive when left is the better pick: likelier name, then newer, then jnid.
function compareCandidate(left: RoofrCandidate, right: RoofrCandidate): number {
  if (left.matchRank !== right.matchRank) return right.matchRank - left.matchRank;
  const byDate = timestamp(left.createdAt) - timestamp(right.createdAt);
  return byDate === 0 ? left.jnid.localeCompare(right.jnid) : byDate;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF extraction timed out")), EXTRACTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isTerminalProviderError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "terminal" in error && error.terminal === true;
}

function telemetryFrom(value: unknown): JobNimbusTelemetry {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    apiCalls: safeCounter(source.apiCalls),
    transientErrorCount: safeCounter(source.transientErrorCount),
    rateLimitResponses: safeCounter(source.rateLimitResponses),
  };
}

function safeCounter(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
