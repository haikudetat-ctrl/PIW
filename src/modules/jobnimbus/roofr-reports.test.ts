// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test as it, vi } from "vitest";
import { JobNimbusProviderError } from "./client";
import {
  RoofrReportError,
  extractRoofrText,
  parseRoofrText,
  runRoofrReports,
  selectRoofrCandidates,
  assertRoofrPrepared,
  type RoofrCandidate,
  type RoofrReportDependencies,
  type RoofrReportRow,
} from "./roofr-reports";

const companyId = "11111111-1111-4111-8111-111111111111";
const fixturePath = path.join(process.cwd(), "src/modules/jobnimbus/__fixtures__/roofr-representative.pdf");

const representativeText = `
Roofr Measurement Report
Total roof area: 2,857 sqft
Predominant pitch: 8 / 12
Total roof facets 14
Two layer area: 200 sqft
Two story area: 1,500 sqft
Flat roof area: 100 sqft
Pitch 6/12 8/12 10/12 12/12
Area (sqft) 324 1,830 347 356
Pitched area (sqft) 2,857 3,143 3,257 3,286
Total roof area: 2,000 sqft
`;

describe("strict Roofr report parsing", () => {
  it("uses the first whole-property total and parses pitch, structure, and waste detail", () => {
    const parsed = parseRoofrText(representativeText);

    expect(parsed).toEqual({
      totalSquares: 28.57,
      predominantPitch12: 8,
      facets: 14,
      twoLayerSquares: 2,
      twoStorySquares: 15,
      flatSquares: 1,
      pitchArea: [
        { pitch12: 6, areaSqft: 324 },
        { pitch12: 8, areaSqft: 1830 },
        { pitch12: 10, areaSqft: 347 },
        { pitch12: 12, areaSqft: 356 },
      ],
      areaWeightedPitch12: 8.51,
      maxPitch12: 12,
      wasteLadder: [0, 10, 14, 15],
      edgesFt: {
        eaves: null, rakes: null, ridges: null, hips: null, valleys: null, wallFlashing: null, stepFlashing: null,
      },
    });
  });

  // Shape of a current Roofr report: the length page and the report summary
  // both carry footage; the summary also has the combined lines.
  const footageText = `${representativeText}
Length measurement report
Eaves: 443ft 9in Valleys: 0ft 0in Hips: 12ft 3in
Ridges: 163ft 6in Rakes: 125ft 10in Wall flashing: 116ft 10in
Step flashing: 0ft 0in Curb flashing: 0ft 0in Transitions: 0ft 0in
Report summary
Total eaves 1,443ft 9in
Total valleys 0ft 0in
Total hips 12ft 3in
Total ridges 163ft 6in
Total rakes 125ft 10in
Total wall flashing 116ft 10in
Total step flashing 0ft 0in
Hips + ridges 175ft 9in
Eaves + rakes 1,569ft 7in
`;

  it("reads edge footage from the report summary in decimal feet", () => {
    expect(parseRoofrText(footageText).edgesFt).toEqual({
      eaves: 1443.75, rakes: 125.83, ridges: 163.5, hips: 12.25, valleys: 0, wallFlashing: 116.83, stepFlashing: 0,
    });
  });

  it("falls back to the length page when a report has no summary totals", () => {
    const lengthOnly = footageText.slice(0, footageText.indexOf("Report summary"));
    expect(parseRoofrText(lengthOnly).edgesFt).toMatchObject({ eaves: 443.75, ridges: 163.5, hips: 12.25 });
  });

  it.each([
    ["inches above eleven", footageText.replace("Total eaves 1,443ft 9in", "Total eaves 1,443ft 12in")],
    ["non-decimal feet", footageText.replace("Total ridges 163ft", "Total ridges 1e3ft")],
    ["feet above the destination boundary", footageText.replace("Total rakes 125ft", "Total rakes 1,000,000ft")],
  ])("rejects footage with %s", (_case, text) => {
    expect(() => parseRoofrText(text)).toThrowError(
      expect.objectContaining({ code: "invalid_report", terminal: true }),
    );
  });

  it("recognises only text that Roofr prepared", () => {
    expect(() => assertRoofrPrepared("This report was prepared by Roofr. Copyright Roofr.com")).not.toThrow();
    expect(() => assertRoofrPrepared("Total roof area: 2,857 sqft\nPrepared by another vendor")).toThrowError(
      expect.objectContaining({ code: "not_roofr", terminal: true }),
    );
  });

  it.each([
    "Total roof area: Infinity sqft",
    "Total roof area: 9007199254740992 sqft",
    "Total roof area: 1e3 sqft",
    "Total roof area: -700 sqft",
  ])("rejects unsafe or non-decimal totals without coercion: %s", (text) => {
    expect(() => parseRoofrText(text)).toThrowError(
      expect.objectContaining({ code: "invalid_report", terminal: true }),
    );
  });

  it("classifies a report below six squares as an outbuilding", () => {
    expect(() =>
      parseRoofrText(representativeText.replace("2,857 sqft", "599 sqft")),
    ).toThrowError(
      expect.objectContaining({ code: "outbuilding", terminal: true }),
    );
  });

  it("accepts values at every destination boundary", () => {
    const parsed = parseRoofrText(`
Total roof area: 99,999,999 sqft
Predominant pitch: 100/12
Total roof facets 10,000
Two layer area: 99,999,999 sqft
Two story area: 99,999,999 sqft
Flat roof area: 99,999,999 sqft
Pitch 100/12
Area (sqft) 99,999,999
Pitched area (sqft) 1 11
`);

    expect(parsed).toMatchObject({
      totalSquares: 999_999.99,
      predominantPitch12: 100,
      facets: 10_000,
      twoLayerSquares: 999_999.99,
      twoStorySquares: 999_999.99,
      flatSquares: 999_999.99,
      pitchArea: [{ pitch12: 100, areaSqft: 99_999_999 }],
      wasteLadder: [0, 1000],
    });
  });

  it.each([
    ["total", "Total roof area: 100,000,000 sqft\nPredominant pitch: 8/12"],
    ["predominant pitch", representativeText.replace("8 / 12", "101 / 12")],
    ["facets", representativeText.replace("facets 14", "facets 10,001")],
    ["two layer", representativeText.replace("200 sqft", "100,000,000 sqft")],
    ["two story", representativeText.replace("1,500 sqft", "100,000,000 sqft")],
    ["flat", representativeText.replace("100 sqft", "100,000,000 sqft")],
    ["pitch table pitch", representativeText.replace("Pitch 6/12", "Pitch 101/12")],
    ["pitch table area", representativeText.replace("Area (sqft) 324", "Area (sqft) 100,000,000")],
    ["waste", representativeText.replace("2,857 3,143 3,257 3,286", "1 12")],
  ])("rejects %s values above the destination boundary", (_field, text) => {
    expect(() => parseRoofrText(text)).toThrowError(
      expect.objectContaining({ code: "invalid_report", terminal: true }),
    );
  });

  it("retains the valid paired prefix when pitch and area token counts differ", () => {
    const parsed = parseRoofrText(representativeText.replace(
      "Area (sqft) 324 1,830 347 356",
      "Area (sqft) 324 1,830",
    ));

    expect(parsed.pitchArea).toEqual([
      { pitch12: 6, areaSqft: 324 },
      { pitch12: 8, areaSqft: 1830 },
    ]);
    expect(parsed.areaWeightedPitch12).toBe(7.7);
    expect(parsed.maxPitch12).toBe(8);
  });
});

describe("Roofr PDF extraction", () => {
  it("rejects report-ish metadata when the bytes do not have PDF magic", async () => {
    const error = await extractRoofrText(
      new TextEncoder().encode("not a pdf"),
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(RoofrReportError);
    expect(error).toMatchObject({ code: "non_pdf", terminal: true });
  });

  it("classifies corrupt magic-bearing bytes without returning partial text", async () => {
    const error = await extractRoofrText(
      new TextEncoder().encode("%PDF-corrupt and truncated"),
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(RoofrReportError);
    expect(error).toMatchObject({ code: "corrupt_pdf", terminal: true });
  });

  it("extracts the representative committed PDF in the deployed Node path", async () => {
    const text = await extractRoofrText(new Uint8Array(await readFile(fixturePath)));

    expect(parseRoofrText(text)).toMatchObject({
      totalSquares: 28.57,
      predominantPitch12: 8,
      facets: 14,
      maxPitch12: 12,
    });
  });
});

describe("Roofr report discovery", () => {
  const candidate = (jnid: string, job: string | null, createdAt: string, matchRank = 0): RoofrCandidate =>
    ({ jnid, filename: `${jnid}.pdf`, relatedJobJnid: job, createdAt, matchRank });

  it("picks one file per job: the likeliest name, then the newest", () => {
    expect(
      selectRoofrCandidates([
        candidate("old", "job-1", "2026-01-01T00:00:00Z"),
        candidate("new", "job-1", "2026-02-01T00:00:00Z"),
        candidate("address-newer", "job-1", "2026-03-01T00:00:00Z", 1),
        candidate("only-shape", "job-2", "2026-01-15T00:00:00Z", 2),
        candidate("unrelated", null, "2026-03-01T00:00:00Z"),
      ], new Map()).map((row) => row.jnid),
    ).toEqual(["new", "only-shape"]);
  });

  it("moves past files that were not Roofr reports to the job's next candidate", () => {
    expect(
      selectRoofrCandidates([
        candidate("quote", "job-1", "2026-03-01T00:00:00Z", 1),
        candidate("report", "job-1", "2026-01-01T00:00:00Z", 1),
      ], new Map([["quote", "not_roofr" as const]])).map((row) => row.jnid),
    ).toEqual(["report"]);
  });

  it("skips files older than the job's ingested report and reads newer re-measures", () => {
    const files = [
      candidate("ingested", "job-1", "2026-02-01T00:00:00Z"),
      candidate("older", "job-1", "2026-01-01T00:00:00Z"),
      candidate("remeasure", "job-1", "2026-03-01T00:00:00Z", 2),
    ];
    expect(selectRoofrCandidates(files, new Map([["ingested", "ingested" as const]])).map((row) => row.jnid))
      .toEqual(["remeasure"]);
    expect(selectRoofrCandidates(files.slice(0, 2), new Map([["ingested", "ingested" as const]]))).toEqual([]);
  });

  it("drains likely names before size-only matches across jobs", () => {
    expect(
      selectRoofrCandidates([
        candidate("a-shape", "job-1", "2026-01-01T00:00:00Z", 2),
        candidate("b-address", "job-2", "2026-01-01T00:00:00Z", 1),
        candidate("c-named", "job-3", "2026-01-01T00:00:00Z", 0),
      ], new Map()).map((row) => row.jnid),
    ).toEqual(["c-named", "b-address", "a-shape"]);
  });
});

describe("Roofr report runs", () => {
  const telemetry = { apiCalls: 1, transientErrorCount: 0, rateLimitResponses: 0 };

  function harness(input: {
    files: RoofrCandidate[];
    processed?: string[];
    download?: (jnid: string) => Promise<{ bytes: Uint8Array; contentType: string | null } & typeof telemetry>;
    text?: string;
  }) {
    const written: RoofrReportRow[] = [];
    const downloadFile = vi.fn(input.download ?? (async () => ({ ...telemetry, bytes: new Uint8Array([1]), contentType: "application/pdf" })));
    const dependencies: RoofrReportDependencies = {
      store: {
        getEnvKeyName: async () => "JOBNIMBUS_API_KEY",
        listRoofrFiles: async () => input.files,
        listProcessedFiles: async () => new Map((input.processed ?? []).map((jnid) => [jnid, "ingested" as const])),
        writeReport: async (row) => { written.push(row); },
      },
      createClient: () => ({ downloadFile }),
      resolveCredential: () => "key",
      extractText: async () => input.text ?? representativeText,
    };
    return { dependencies, written, downloadFile };
  }

  const file = (jnid: string, job: string, createdAt = "2026-01-01T00:00:00Z"): RoofrCandidate =>
    ({ jnid, filename: `Roofr ${jnid}.pdf`, relatedJobJnid: job, createdAt, matchRank: 0 });

  it("ingests the newest unprocessed report per job, keyed by the JobNimbus job", async () => {
    const { dependencies, written, downloadFile } = harness({
      files: [file("old", "job-1"), file("new", "job-1", "2026-02-01T00:00:00Z"), file("done", "job-2")],
      processed: ["done"],
    });

    const result = await runRoofrReports({ companyId }, dependencies);

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledWith("new");
    expect(written).toEqual([expect.objectContaining({
      companyId, fileJnid: "new", jobJnid: "job-1", outcome: "ingested",
      measurement: expect.objectContaining({ totalSquares: 28.57 }),
    })]);
    expect(result).toMatchObject({ candidates: 1, processed: 1, ingested: 1, retryLater: 0, apiCalls: 1 });
  });

  it("records a terminal outcome and no measurement for an unreadable report", async () => {
    const { dependencies, written } = harness({ files: [file("small", "job-1")], text: "Roofr\nTotal roof area: 400 sqft" });

    await runRoofrReports({ companyId }, dependencies);

    expect(written).toEqual([expect.objectContaining({ fileJnid: "small", outcome: "outbuilding", measurement: null })]);
  });

  it("records a PDF that Roofr did not prepare as not a Roofr report", async () => {
    const { dependencies, written } = harness({ files: [file("quote", "job-1")], text: "Roof quote\nTotal roof area: 2,857 sqft" });

    await runRoofrReports({ companyId }, dependencies);

    expect(written).toEqual([expect.objectContaining({ fileJnid: "quote", outcome: "not_roofr", measurement: null })]);
  });

  it("records terminal provider failures with their request telemetry", async () => {
    const { dependencies, written } = harness({
      files: [file("gone", "job-1")],
      download: async () => {
        throw new JobNimbusProviderError("not found", {
          terminal: true, status: 404, code: "http",
          telemetry: { apiCalls: 2, transientErrorCount: 1, rateLimitResponses: 0 },
        });
      },
    });

    await runRoofrReports({ companyId }, dependencies);

    expect(written).toEqual([expect.objectContaining({
      outcome: "provider_terminal",
      telemetry: { apiCalls: 2, transientErrorCount: 1, rateLimitResponses: 0 },
    })]);
  });

  it("writes nothing for a transient failure so the next run retries it", async () => {
    const { dependencies, written } = harness({
      files: [file("flaky", "job-1"), file("ok", "job-2")],
      download: async (jnid) => {
        if (jnid === "flaky") throw new Error("socket hang up");
        return { ...telemetry, bytes: new Uint8Array([1]), contentType: "application/pdf" };
      },
    });

    const result = await runRoofrReports({ companyId }, dependencies);

    expect(written.map((row) => row.fileJnid)).toEqual(["ok"]);
    expect(result).toMatchObject({ processed: 1, retryLater: 1 });
  });

  it("caps each run and skips credential lookup when there is nothing to do", async () => {
    const capped = harness({ files: [file("a", "job-1"), file("b", "job-2"), file("c", "job-3")] });
    expect(await runRoofrReports({ companyId, limit: 2 }, capped.dependencies)).toMatchObject({ candidates: 3, processed: 2 });

    const idle = harness({ files: [file("a", "job-1")], processed: ["a"] });
    idle.dependencies.resolveCredential = () => { throw new Error("must not resolve"); };
    expect(await runRoofrReports({ companyId }, idle.dependencies)).toMatchObject({ candidates: 0, processed: 0 });
  });

  it("fails loudly when the JobNimbus credential is missing", async () => {
    const { dependencies } = harness({ files: [file("a", "job-1")] });
    dependencies.resolveCredential = () => undefined;
    await expect(runRoofrReports({ companyId }, dependencies)).rejects.toThrow("Missing JobNimbus report credential");
  });
});
