import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import type { Database, Json } from "@/lib/database.types";
import type { JobNimbusFileDownload, JobNimbusTelemetry } from "./client";

// Roofr measurement reports attached to JobNimbus jobs are the measured roof:
// what a Google Solar estimate is checked against. Parsing and extraction are
// ported unchanged from 2stack-roof-quote, where they were proven against the
// All Season account's real reports.

const SQUARE_FEET_PER_SQUARE = 100;
const MAX_REPORT_BYTES = 25 * 1024 * 1024;
const MAX_REPORT_PAGES = 100;
const EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_AREA_SQFT = 99_999_999;
const MAX_PITCH_12 = 100;
const MAX_FACETS = 10_000;
const MAX_WASTE_PERCENT = 1_000;
const DEFAULT_REPORTS_PER_RUN = 20;

export type RoofrReportErrorCode =
  | "non_pdf"
  | "corrupt_pdf"
  | "invalid_report"
  | "outbuilding"
  | "invalid_candidate"
  | "provider_terminal";

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
};

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
  };
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

export type RoofrCandidate = {
  jnid: string;
  filename: string | null;
  relatedJobJnid: string | null;
  createdAt: string | null;
};

// A job can carry several Roofr reports (re-measures); only the newest is the
// measurement of record.
export function selectNewestRoofrCandidates(files: RoofrCandidate[]): RoofrCandidate[] {
  const newest = new Map<string, RoofrCandidate>();
  for (const file of files) {
    if (file.relatedJobJnid === null || file.filename === null || !/roofr/i.test(file.filename)) {
      continue;
    }
    const prior = newest.get(file.relatedJobJnid);
    if (prior === undefined || compareCandidate(file, prior) > 0) {
      newest.set(file.relatedJobJnid, file);
    }
  }
  return [...newest.values()].sort((left, right) => left.jnid.localeCompare(right.jnid));
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
  listProcessedFileJnids(companyId: string): Promise<Set<string>>;
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
    dependencies.store.listProcessedFileJnids(input.companyId),
  ]);
  const pending = selectNewestRoofrCandidates(files).filter((file) => !processed.has(file.jnid));
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
      const measurement = parseRoofrText(await dependencies.extractText(download.bytes));
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
        .from("jn_files")
        .select("jnid, filename, related_job_jnid, jn_created_at")
        .eq("company_id", companyId)
        .ilike("filename", "%roofr%")
        .not("related_job_jnid", "is", null);
      if (error || !data) throw new Error("Roofr report file listing failed", { cause: error });
      return data.map((file) => ({
        jnid: file.jnid,
        filename: file.filename,
        relatedJobJnid: file.related_job_jnid,
        createdAt: file.jn_created_at,
      }));
    },

    async listProcessedFileJnids(companyId) {
      const { data, error } = await database
        .from("jobnimbus_roofr_reports")
        .select("file_jnid")
        .eq("company_id", companyId);
      if (error || !data) throw new Error("Roofr report outcome listing failed", { cause: error });
      return new Set(data.map((row) => row.file_jnid));
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

function compareCandidate(left: RoofrCandidate, right: RoofrCandidate): number {
  const byDate = (Date.parse(left.createdAt ?? "") || 0) - (Date.parse(right.createdAt ?? "") || 0);
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
