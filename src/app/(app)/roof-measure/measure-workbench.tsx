"use client";

import Link from "next/link";
import {useMemo, useReducer, useState} from "react";
import {
  buildRoofMeasurementReport,
  computeRoofEdges,
  distanceMeters,
  isWall,
  POSSIBLE_WALL_PITCH_RISE,
  estimateStories,
  parseSolarForDrawing,
  percentDifference,
  pickActiveSquares,
  pitchRiseFromDegrees,
  planesFromSolar,
  roofEdgeKindLabels,
  roofEdgeKinds,
  slopedAreaSqft,
  solarSquares,
  type MeasuredReportInput,
  type RoofEdgeKind,
  type SolarDrawingInsight,
} from "@/domain/roof-drawing";
import {
  priceSquares,
  saveMeasurementHandoff,
  triggeredAdjustments,
  withPercentAdjustments,
  type StoryAnswer,
} from "@/modules/roof-measure/measure-pricing";
import {initialMeasureState, measureReducer, snapCorner, type MeasureAction} from "@/modules/roof-measure/measure-state";
import {
  SAVED_DRAWING_VERSION,
  type JobOption,
  type SavedMeasurement,
  type SavedMeasurementSummary,
} from "@/modules/roof-measure/saved-drawing";
import {RoofPlaneMap} from "./roof-plane-map-loader";
import {edgeKindColors} from "@/modules/roof-measure/edge-colors";

type LookupResponse = {
  location: {lat: number; lng: number};
  formattedAddress: string | null;
  solar: {status: "success"; raw: unknown; cached: boolean} | {status: "no_coverage"; cached: boolean};
  groundElevationMeters: number | null;
  elevationNote: string | null;
};

type Lookup =
  | {status: "idle"}
  | {status: "loading"}
  | {status: "error"; message: string}
  | {status: "no_coverage"; response: LookupResponse}
  | {status: "ready"; response: LookupResponse; insight: SolarDrawingInsight};

const WRONG_BUILDING_WARNING_M = 30;
const money = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
const num = (value: number, digits = 1) => value.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits});
const diff = (value: number | null) => (value === null ? "" : `${value >= 0 ? "+" : ""}${num(value)}%`);
const storyLabels: Record<StoryAnswer, string> = {one: "One story", two: "Two stories", three_plus: "Three or more", unknown: "Unknown"};
const tierLabels = {measured: "Measured report", drawn: "Drawing", solar: "Solar (blended)"} as const;

function parseCoordinates(text: string) {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  return match ? {lat: Number(match[1]), lng: Number(match[2])} : null;
}

const emptyMeasured: MeasuredReportInput = {source: "Roofr", totalSqft: null, predominantPitchRise: null, lengthsFt: {}};
const measuredLengthKinds: RoofEdgeKind[] = ["eave", "rake", "ridge", "hip", "valley", "step_flashing", "wall_flashing"];

type ActionResult<T> = {ok: true; value: T} | {ok: false; error: string};

export type MeasureStorage = {
  save: (input: unknown) => Promise<ActionResult<{id: string}>>;
  list: () => Promise<ActionResult<SavedMeasurementSummary[]>>;
  searchJobs: (query: string) => Promise<ActionResult<JobOption[]>>;
};

export function MeasureWorkbench({fetchLookup = defaultFetchLookup, sandboxLinks = false, storage = null, initialSaved = null}: {
  fetchLookup?: (query: string, quality: string) => Promise<LookupResponse>;
  /** Links to the dev-only assessment sandbox, which 404s outside local development. */
  sandboxLinks?: boolean;
  /** Saving and job linking; absent in tests that don't need it. */
  storage?: MeasureStorage | null;
  /** A saved drawing to reopen (from ?m=). */
  initialSaved?: SavedMeasurement | null;
}) {
  const [query, setQuery] = useState(initialSaved?.address ?? "");
  const [quality, setQuality] = useState("HIGH");
  const [reopen] = useState(() => (initialSaved ? reopenSaved(initialSaved) : null));
  const [lookup, setLookup] = useState<Lookup>(reopen?.lookup ?? {status: "idle"});
  const [state, dispatch] = useReducer(
    measureReducer,
    initialMeasureState,
    (initial) => (reopen ? measureReducer(initial, reopen.load) : initial),
  );
  const [measured, setMeasured] = useState<MeasuredReportInput>(initialSaved?.measured ?? emptyMeasured);
  const [storiesOverride, setStoriesOverride] = useState<StoryAnswer | null>(initialSaved?.stories ?? null);
  const [wasteOverride, setWasteOverride] = useState<number | null>(initialSaved?.wastePercent ?? null);
  const [showFill, setShowFill] = useState(true);
  const [handoffSaved, setHandoffSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(initialSaved?.id ?? null);
  const [job, setJob] = useState<JobOption | null>(
    initialSaved?.jobJnid ? {jnid: initialSaved.jobJnid, label: initialSaved.jobLabel ?? initialSaved.jobJnid} : null,
  );
  const [saveState, setSaveState] = useState<{status: "idle" | "saving" | "saved" | "error"; message?: string}>({status: "idle"});
  const [savedList, setSavedList] = useState<SavedMeasurementSummary[] | null>(null);

  const origin = state.origin;
  const edges = useMemo(
    () => (origin ? computeRoofEdges(origin, state.planes, state.overrides, state.pairModes) : []),
    [origin, state.planes, state.overrides, state.pairModes],
  );
  const report = useMemo(() => (origin ? buildRoofMeasurementReport(origin, state.planes, edges) : null), [origin, state.planes, edges]);
  const insight = lookup.status === "ready" ? lookup.insight : null;
  const solar = insight ? solarSquares(insight) : null;
  const storyEstimate = insight && lookup.status === "ready" ? estimateStories(insight, lookup.response.groundElevationMeters) : null;
  const stories: StoryAnswer = storiesOverride ?? storyEstimate?.stories ?? "unknown";
  const measuredInput = measured.totalSqft ? measured : null;
  const active = pickActiveSquares({solar, drawn: report, measured: measuredInput});
  const roofPlanes = state.planes.filter((plane) => !isWall(plane));
  const maxPitchRise = roofPlanes.length ? Math.max(...roofPlanes.map((plane) => pitchRiseFromDegrees(plane.pitchDegrees))) : null;
  const pricing = active ? priceSquares(active.squares, "2026-11-27T00:00:00.000Z") : null;
  const adjustments = triggeredAdjustments({predominantPitchRise: report?.predominantPitchRise ?? null, maxPitchRise, stories});
  const selectedPlane = state.planes.find((plane) => plane.id === state.selectedPlaneId) ?? null;
  const selectedEdge = edges.find((edge) => edge.id === state.selectedEdgeId) ?? null;
  const wastePercent = wasteOverride ?? report?.suggestedWastePercent ?? 10;
  const address = lookup.status === "ready" || lookup.status === "no_coverage" ? lookup.response.formattedAddress ?? query : query;

  async function runLookup(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLookup({status: "loading"});
    setHandoffSaved(false);
    try {
      const response = await fetchLookup(query, quality);
      if (response.solar.status !== "success") {
        setLookup({status: "no_coverage", response});
        setSavedId(null);
        setSaveState({status: "idle"});
        dispatch({type: "load", origin: response.location, planes: []});
        return;
      }
      const parsed = parseSolarForDrawing(response.solar.raw);
      setLookup({status: "ready", response, insight: parsed});
      setStoriesOverride(null);
      setWasteOverride(null);
      setSavedId(null);
      setSaveState({status: "idle"});
      dispatch({type: "load", origin: parsed.center, planes: planesFromSolar(parsed)});
    } catch (error) {
      setLookup({status: "error", message: error instanceof Error ? error.message : "Lookup failed"});
    }
  }

  async function saveDrawing() {
    if (!storage || !origin || !report) return;
    setSaveState({status: "saving"});
    const solarRaw = lookup.status === "ready" && lookup.response.solar.status === "success" ? lookup.response.solar.raw : null;
    const result = await storage.save({
      id: savedId,
      address: address.trim() || "Unnamed roof",
      latitude: origin.lat,
      longitude: origin.lng,
      solarBuildingName: insight?.buildingName ?? null,
      solarImageryDate: insight?.imageryDate ?? null,
      solarResponse: solarRaw && typeof solarRaw === "object" ? solarRaw : null,
      drawing: {version: SAVED_DRAWING_VERSION, planes: state.planes, overrides: state.overrides, pairModes: state.pairModes},
      measured: measuredInput,
      stories,
      wastePercent,
      totalSlopedSqft: report.totalSlopedSqft,
      squares: report.squares,
      predominantPitchRise: report.predominantPitchRise,
      lengthsFt: report.lengthsFt,
      jobJnid: job?.jnid ?? null,
    });
    if (result.ok) {
      setSavedId(result.value.id);
      setSaveState({status: "saved"});
      window.history.replaceState(null, "", `?m=${result.value.id}`);
    } else {
      setSaveState({status: "error", message: result.error});
    }
  }

  function measurementJson() {
    return JSON.stringify({
      address,
      solarBuilding: insight?.buildingName ?? null,
      solarImageryDate: insight?.imageryDate ?? null,
      activeSquares: active,
      solarSquares: solar,
      drawing: report,
      edges: edges.map((edge) => ({id: edge.id, kind: edge.kind, autoKind: edge.autoKind, planes: edge.planeIds, trueLengthFt: Number(edge.trueLengthFt.toFixed(2))})),
      measured: measuredInput,
      stories,
      wastePercent,
    }, null, 2);
  }

  return (
    <div className="min-h-full bg-slate-50 font-sans text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-amber-700">Prototype · staff only · not customer facing</p>
          <h1 className="text-lg font-semibold">Roof measuring sandbox</h1>
        </div>
        {sandboxLinks ? <Link href="/roof-estimate/dev-assessment" className="text-xs font-semibold text-slate-600 underline">Back to assessment sandbox</Link> : null}
      </header>

      <form onSubmit={runLookup} className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <label className="grid min-w-72 flex-1 gap-1 text-xs font-semibold text-slate-600">
          Address, or latitude, longitude
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="18 Harbor View Drive, Red Bank, NJ" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Solar quality
          <select value={quality} onChange={(event) => setQuality(event.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm font-normal">
            <option value="HIGH">High (same as live)</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <button type="submit" disabled={lookup.status === "loading"} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {lookup.status === "loading" ? "Looking up…" : "Look up roof"}
        </button>
        <LookupStatus lookup={lookup} />
      </form>

      {origin ? (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <section className="relative flex min-h-[32rem] flex-col border-r border-slate-200">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
              {state.mode === "draw" ? (
                <>
                  <span className="font-semibold text-amber-700">Click corners on the aerial ({state.draft.length} so far), then finish.</span>
                  <ToolButton onClick={() => dispatch({type: "finishDraw"})} disabled={state.draft.length < 3}>Finish plane</ToolButton>
                  <ToolButton onClick={() => dispatch({type: "cancelDraw"})}>Cancel</ToolButton>
                </>
              ) : (
                <>
                  <ToolButton onClick={() => dispatch({type: "startDraw"})}>Draw a plane</ToolButton>
                  <ToolButton onClick={() => dispatch({type: "undo"})} disabled={state.history.length === 0}>Undo</ToolButton>
                  <ToolButton onClick={() => dispatch({type: "resetToSolar"})}>Reset to Solar</ToolButton>
                  <label className="ml-auto flex items-center gap-1 text-slate-600">
                    <input type="checkbox" checked={showFill} onChange={(event) => setShowFill(event.target.checked)} /> Plane fill
                  </label>
                </>
              )}
            </div>
            <div className="flex-1">
              <RoofPlaneMap
                key={insight?.buildingName ?? "map"}
                center={origin}
                planes={state.planes}
                edges={edges}
                selectedPlaneId={state.selectedPlaneId}
                selectedEdgeId={state.selectedEdgeId}
                mode={state.mode}
                draft={state.draft}
                showPlaneFill={showFill}
                dispatch={dispatch}
                previewSnap={(planeId, index, to) => {
                  const plane = state.planes.find((item) => item.id === planeId);
                  return plane && origin ? snapCorner(state, origin, plane, index, to) : {point: to, snapped: false};
                }}
              />
            </div>
            <p className="border-t border-slate-200 bg-white px-3 py-2 text-[0.7rem] leading-5 text-slate-500">
              Click a plane to edit it: drag a square corner to move it (it snaps to nearby corners and squares up to the building; hold Alt to drag freely), click a + to add a corner, right-click a corner to delete it. Click an edge line to relabel it, or to join or split two planes there. Dashed amber planes are untouched Solar; dashed edges need a look. Aerial is NJGIN 2020; Solar planes come from Google imagery{insight?.imageryDate ? ` dated ${insight.imageryDate}` : ""}.
            </p>
          </section>

          <aside className="grid content-start gap-4 p-4 text-sm">
            {selectedPlane ? (
              <Panel title={`Plane ${selectedPlane.id}`}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs text-slate-600">
                    Pitch (x/12)
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={24}
                      aria-label="Pitch rise per 12"
                      value={Number(pitchRiseFromDegrees(selectedPlane.pitchDegrees).toFixed(1))}
                      onChange={(event) => dispatch({type: "setPitchRise", planeId: selectedPlane.id, rise: Number(event.target.value)})}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-slate-600">
                    Faces (degrees)
                    <input
                      type="number"
                      step={5}
                      aria-label="Facing direction in degrees"
                      value={Math.round(selectedPlane.azimuthDegrees)}
                      onChange={(event) => dispatch({type: "setAzimuth", planeId: selectedPlane.id, azimuthDegrees: Number(event.target.value)})}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {num(slopedAreaSqft(origin, selectedPlane), 0)} sq ft on the roof
                  {selectedPlane.solarSlopedAreaSqft ? ` · Solar said ${num(selectedPlane.solarSlopedAreaSqft, 0)}` : ""}
                  {` · ${selectedPlane.source}`}
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={isWall(selectedPlane)}
                    onChange={(event) => dispatch({type: "setSurface", planeId: selectedPlane.id, surface: event.target.checked ? "wall" : "roof"})}
                  />
                  Not roof (wall face): leave out of squares
                </label>
                {!isWall(selectedPlane) && pitchRiseFromDegrees(selectedPlane.pitchDegrees) > POSSIBLE_WALL_PITCH_RISE ? (
                  <p className="mt-1 text-[0.7rem] leading-5 text-amber-800">Steeper than {POSSIBLE_WALL_PITCH_RISE}/12. If this is a dormer cheek or wall, tick Not roof; if it is shingled, leave it and it prices as steep.</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <ToolButton onClick={() => dispatch({type: "squareUp", planeId: selectedPlane.id})} disabled={state.axisDegrees === null}>Square up</ToolButton>
                  <ToolButton onClick={() => dispatch({type: "setAzimuth", planeId: selectedPlane.id, azimuthDegrees: selectedPlane.azimuthDegrees + 180})}>Flip facing</ToolButton>
                  <ToolButton onClick={() => dispatch({type: "deletePlane", planeId: selectedPlane.id})}>Delete plane</ToolButton>
                </div>
              </Panel>
            ) : null}

            {selectedEdge ? (
              <Panel title="Edge">
                <label className="grid gap-1 text-xs text-slate-600">
                  Type
                  <select
                    aria-label="Edge type"
                    value={selectedEdge.overridden ? selectedEdge.kind : "auto"}
                    onChange={(event) => dispatch({type: "setEdgeKind", edgeId: selectedEdge.id, kind: event.target.value === "auto" ? null : event.target.value as RoofEdgeKind})}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                  >
                    <option value="auto">Auto ({roofEdgeKindLabels[selectedEdge.autoKind]})</option>
                    {roofEdgeKinds.map((kind) => <option key={kind} value={kind}>{roofEdgeKindLabels[kind]}</option>)}
                  </select>
                </label>
                <p className="mt-2 text-xs text-slate-600">
                  {num(selectedEdge.trueLengthFt)} ft along the roof ({num(selectedEdge.planLengthFt)} ft from above) · {selectedEdge.planeIds.length === 2 ? `shared by ${selectedEdge.planeIds.join(" and ")}` : `edge of ${selectedEdge.planeIds[0]}`}
                </p>
                {selectedEdge.pair ? (
                  <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                    <p>
                      Meets {selectedEdge.pair.otherPlaneId}. {selectedEdge.pair.joined
                        ? "Joined: one edge, counted once (ridge, hip, valley)."
                        : "Split: each plane keeps its own edge and both are counted (an eave above, step flashing below)."}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <ToolButton
                        onClick={() => dispatch({type: "setPairMode", pairKey: selectedEdge.pair!.key, mode: "join"})}
                        disabled={selectedEdge.pair.joined}
                      >
                        Join
                      </ToolButton>
                      <ToolButton
                        onClick={() => dispatch({type: "setPairMode", pairKey: selectedEdge.pair!.key, mode: "split"})}
                        disabled={!selectedEdge.pair.joined}
                      >
                        Split
                      </ToolButton>
                      {state.pairModes[selectedEdge.pair.key] ? (
                        <ToolButton onClick={() => dispatch({type: "setPairMode", pairKey: selectedEdge.pair!.key, mode: null})}>Auto</ToolButton>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </Panel>
            ) : null}

            <Panel title="Squares by tier">
              <table className="w-full text-xs">
                <tbody>
                  {solar ? (
                    <>
                      <TierRow label="1 · Solar facet sum (live price today)" value={solar.facetSumSquares} reference={measuredInput?.totalSqft} />
                      {solar.buildingSquares !== null ? <TierRow label="1 · Solar building area" value={solar.buildingSquares} reference={measuredInput?.totalSqft} /> : null}
                      <TierRow label="1 · Solar blended" value={solar.blendedSquares} reference={measuredInput?.totalSqft} active={active?.tier === "solar"} />
                    </>
                  ) : null}
                  {report ? <TierRow label={`2 · Drawing (${report.editedPlaneCount} of ${report.planeCount} planes edited)`} value={report.squares} reference={measuredInput?.totalSqft} active={active?.tier === "drawn"} /> : null}
                  {measuredInput?.totalSqft ? <TierRow label={`3 · ${measured.source || "Measured"} report`} value={measuredInput.totalSqft / 100} active={active?.tier === "measured"} /> : null}
                </tbody>
              </table>
              <p className="mt-2 text-[0.7rem] leading-5 text-slate-500">Pricing uses the bold row: a measured report if typed in, otherwise the drawing once you edit it, otherwise Solar blended (median error 6.3% vs 9.8% for facet sum on 12 Roofr jobs, a small sample).</p>
            </Panel>

            {report ? (
              <Panel title="Measurement report">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500">Roof area</dt><dd>{num(report.totalSlopedSqft, 0)} sq ft</dd>
                  <dt className="text-slate-500">Squares</dt><dd>{num(report.squares)}</dd>
                  <dt className="text-slate-500">Planes</dt><dd>{report.planeCount}</dd>
                  <dt className="text-slate-500">Predominant pitch</dt><dd>{report.predominantPitchRise === null ? "–" : `${report.predominantPitchRise}/12`}</dd>
                  <dt className="text-slate-500">Edges to check</dt><dd>{report.reviewEdgeCount}</dd>
                  {report.steepSqft > 0 ? <><dt className="text-slate-500">Steep (over 10/12)</dt><dd>{num(report.steepSqft, 0)} sq ft</dd></> : null}
                  {report.wallPlaneCount > 0 ? <><dt className="text-slate-500">Left out as wall</dt><dd>{report.wallPlaneCount} faces, {num(report.wallSqft, 0)} sq ft</dd></> : null}
                </dl>
                {report.possibleWallPlaneIds.length ? (
                  <p className="mt-2 text-[0.7rem] leading-5 text-amber-800">
                    {report.possibleWallPlaneIds.join(", ")} {report.possibleWallPlaneIds.length === 1 ? "is" : "are"} steeper than {POSSIBLE_WALL_PITCH_RISE}/12 and counted as roof. Mark any wall face as Not roof.
                  </p>
                ) : null}
                <h3 className="mt-3 text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-400">Pitch</h3>
                <ul className="mt-1 grid gap-0.5 text-xs">
                  {report.pitchBreakdown.map((row) => (
                    <li key={row.pitchRise}>{row.pitchRise}/12 · {num(row.sqft, 0)} sq ft · {num(row.share * 100, 0)}%</li>
                  ))}
                </ul>
                <h3 className="mt-3 text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-400">Lengths (ft)</h3>
                <table className="mt-1 w-full text-xs">
                  <thead><tr className="text-left text-slate-400"><th className="font-normal">Type</th><th className="font-normal">Drawn</th><th className="font-normal">Report</th></tr></thead>
                  <tbody>
                    {roofEdgeKinds.filter((kind) => report.lengthsFt[kind] > 0 || measured.lengthsFt[kind]).map((kind) => (
                      <tr key={kind}>
                        <td><span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full" style={{background: edgeKindColors[kind]}} />{roofEdgeKindLabels[kind]}</td>
                        <td>{num(report.lengthsFt[kind], 0)}</td>
                        <td>{measured.lengthsFt[kind] ? `${num(measured.lengthsFt[kind] as number, 0)} (${diff(percentDifference(report.lengthsFt[kind], measured.lengthsFt[kind] as number))})` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="mt-3 text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-400">Waste</h3>
                <table className="mt-1 w-full text-xs">
                  <thead><tr className="text-left text-slate-400"><th className="font-normal">Waste</th><th className="font-normal">Squares</th><th className="font-normal">Bundles</th></tr></thead>
                  <tbody>
                    {report.wasteTable.map((row) => (
                      <tr key={row.percent} className={row.percent === wastePercent ? "font-semibold" : undefined}>
                        <td>
                          <button type="button" onClick={() => setWasteOverride(row.percent)} className="underline-offset-2 hover:underline">{row.percent}%</button>
                          {row.percent === report.suggestedWastePercent ? " (suggested)" : ""}
                        </td>
                        <td>{num(row.squares)}</td>
                        <td>{row.bundles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            ) : null}

            <Panel title="Stories">
              <select
                aria-label="Stories"
                value={storiesOverride ?? "auto"}
                onChange={(event) => setStoriesOverride(event.target.value === "auto" ? null : event.target.value as StoryAnswer)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="auto">Solar guess: {storyLabels[storyEstimate?.stories ?? "unknown"]}</option>
                {(Object.keys(storyLabels) as StoryAnswer[]).map((key) => <option key={key} value={key}>{storyLabels[key]}</option>)}
              </select>
              {storyEstimate ? (
                <p className="mt-2 text-[0.7rem] leading-5 text-slate-500">
                  {storyEstimate.eaveHeightFt ? `Eave about ${num(storyEstimate.eaveHeightFt, 0)} ft above ground. ` : ""}{storyEstimate.note}
                  {lookup.status === "ready" && lookup.response.elevationNote ? ` ${lookup.response.elevationNote}.` : ""}
                </p>
              ) : null}
            </Panel>

            <Panel title="Measured report (tier 3)">
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Source" text value={measured.source} onText={(value) => setMeasured({...measured, source: value})} />
                <NumberField label="Total sq ft" value={measured.totalSqft} onNumber={(value) => setMeasured({...measured, totalSqft: value})} />
                {measuredLengthKinds.map((kind) => (
                  <NumberField
                    key={kind}
                    label={`${roofEdgeKindLabels[kind]} ft`}
                    value={measured.lengthsFt[kind] ?? null}
                    onNumber={(value) => setMeasured({...measured, lengthsFt: {...measured.lengthsFt, [kind]: value ?? undefined}})}
                  />
                ))}
              </div>
            </Panel>

            {pricing && active ? (
              <Panel title={`Price on ${num(pricing.roofSquares)} squares (${tierLabels[active.tier]})`}>
                <ul className="grid gap-1 text-xs">
                  {pricing.packages.map((item) => (
                    <li key={item.tierKey} className={item.recommended ? "font-semibold" : undefined}>
                      {item.customerName}: {money.format(item.rangeLowCents / 100)} to {money.format(item.rangeHighCents / 100)}
                    </li>
                  ))}
                </ul>
                {adjustments.length ? (
                  <p className="mt-2 text-[0.7rem] leading-5 text-amber-800">
                    Would trigger {adjustments.map((item) => item.label).join(", ")}. Live pricing only discloses this; if added, Landmark becomes {money.format(withPercentAdjustments(pricing.primary.rangeLowCents, adjustments, "low") / 100)} to {money.format(withPercentAdjustments(pricing.primary.rangeHighCents, adjustments, "high") / 100)}.
                  </p>
                ) : null}
                <p className="mt-2 text-[0.7rem] leading-5 text-slate-500">Rates are a sandbox copy of the All Season NJ 2026 seed. Squares exclude waste, as live pricing does.</p>
              </Panel>
            ) : null}

            {storage && report ? (
              <Panel title={savedId ? "Saved drawing" : "Save this drawing"}>
                <JobPicker storage={storage} job={job} onChange={setJob} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={saveDrawing}
                    disabled={saveState.status === "saving"}
                    className="rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {saveState.status === "saving" ? "Saving…" : savedId ? "Save changes" : "Save drawing"}
                  </button>
                  <ToolButton
                    onClick={async () => {
                      const result = await storage.list();
                      setSavedList(result.ok ? result.value : []);
                      if (!result.ok) setSaveState({status: "error", message: result.error});
                    }}
                  >
                    Saved drawings
                  </ToolButton>
                  {saveState.status === "saved" ? <span role="status" className="text-xs text-emerald-700">Saved</span> : null}
                </div>
                {saveState.status === "error" ? <p role="alert" className="mt-2 text-xs text-red-700">{saveState.message}</p> : null}
                {savedList ? (
                  <ul aria-label="Saved drawings" className="mt-2 grid gap-1 text-xs">
                    {savedList.length === 0 ? <li className="text-slate-500">Nothing saved yet.</li> : null}
                    {savedList.map((item) => (
                      <li key={item.id}>
                        <a href={`/roof-measure?m=${item.id}`} className="underline">{item.address}</a>
                        {` · ${num(item.squares)} sq`}{item.jobLabel ? ` · ${item.jobLabel}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Panel>
            ) : null}

            {active ? (
              <div className="flex flex-wrap gap-2">
                {sandboxLinks ? <button
                  type="button"
                  className="rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() => {
                    saveMeasurementHandoff({
                      address,
                      squares: active.squares,
                      tier: active.tier,
                      stories,
                      predominantPitchRise: report?.predominantPitchRise ?? null,
                      maxPitchRise,
                      savedAt: new Date().toISOString(),
                    });
                    setHandoffSaved(true);
                  }}
                >
                  Use in assessment sandbox
                </button> : null}
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(measurementJson());
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy report JSON"}
                </button>
                {handoffSaved ? (
                  <Link href="/roof-estimate/dev-assessment?result=ready" className="self-center text-xs font-semibold text-slate-700 underline">Open the customer result with these numbers</Link>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      ) : (
        <p className="px-5 py-10 text-sm text-slate-500">
          Look up an address to load Google Solar planes over the NJGIN aerial. A new address costs one Building Insights call, one Places search and one Elevation call; repeat lookups are cached while the server stays warm.
        </p>
      )}
    </div>
  );
}

/** Lookup state and drawing for a saved measurement, from the Solar response stored with it. */
function reopenSaved(saved: SavedMeasurement): {lookup: Lookup; load: MeasureAction} {
  const origin = {lat: saved.latitude, lng: saved.longitude};
  const response: LookupResponse = {
    location: origin,
    formattedAddress: saved.address,
    solar: saved.solarResponse ? {status: "success", raw: saved.solarResponse, cached: true} : {status: "no_coverage", cached: true},
    groundElevationMeters: null,
    elevationNote: null,
  };
  if (saved.solarResponse) {
    try {
      const insight = parseSolarForDrawing(saved.solarResponse);
      return {
        lookup: {status: "ready", response, insight},
        load: {type: "load", origin: insight.center, planes: planesFromSolar(insight), saved: saved.drawing},
      };
    } catch {
      // Fall through: reopen the drawing without Solar tiers.
    }
  }
  return {lookup: {status: "no_coverage", response}, load: {type: "load", origin, planes: [], saved: saved.drawing}};
}

async function defaultFetchLookup(query: string, quality: string): Promise<LookupResponse> {
  const params = new URLSearchParams({quality});
  const coordinates = parseCoordinates(query);
  if (coordinates) {
    params.set("lat", String(coordinates.lat));
    params.set("lng", String(coordinates.lng));
  } else {
    params.set("address", query);
  }
  const response = await fetch(`/api/roof-measure/solar?${params}`);
  const body = await response.json() as LookupResponse & {error?: string};
  if (!response.ok) throw new Error(body.error ?? `Lookup failed (${response.status})`);
  return body;
}

function LookupStatus({lookup}: {lookup: Lookup}) {
  if (lookup.status === "error") return <p role="alert" className="text-xs text-red-700">{lookup.message}</p>;
  if (lookup.status === "no_coverage") {
    return <p role="status" className="text-xs text-amber-800">Google Solar has no coverage at this quality. Try Medium, or draw the planes by hand on the aerial.</p>;
  }
  if (lookup.status !== "ready") return null;
  const {insight, response} = lookup;
  const offset = distanceMeters(response.location, insight.center);
  return (
    <p role="status" className="text-xs text-slate-600">
      {response.formattedAddress ?? "Location"} · {insight.segments.length} Solar segments · imagery {insight.imageryDate ?? "date unknown"} ({insight.imageryQuality ?? "quality unknown"}){response.solar.cached ? " · cached" : " · live call"}
      {offset > WRONG_BUILDING_WARNING_M ? <span className="ml-1 font-semibold text-red-700">Solar picked a building {Math.round(offset)} m from the address; it may be the wrong one.</span> : null}
    </p>
  );
}

function JobPicker({storage, job, onChange}: {storage: MeasureStorage; job: JobOption | null; onChange: (job: JobOption | null) => void}) {
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<JobOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (job) {
    return (
      <p className="text-xs text-slate-700">
        Linked to JobNimbus job {job.label}{" "}
        <button type="button" className="underline" onClick={() => onChange(null)}>Unlink</button>
      </p>
    );
  }
  return (
    <div className="grid gap-1">
      <label className="grid gap-1 text-xs text-slate-600">
        Link to a JobNimbus job (optional)
        <input
          value={term}
          placeholder="Street or job number"
          onChange={async (event) => {
            const value = event.target.value;
            setTerm(value);
            const result = await storage.searchJobs(value);
            if (result.ok) {
              setOptions(result.value);
              setError(null);
            } else {
              setError(result.error);
            }
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
        />
      </label>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {options.length ? (
        <ul aria-label="Matching jobs" className="grid gap-0.5 text-xs">
          {options.map((option) => (
            <li key={option.jnid}>
              <button type="button" className="underline" onClick={() => { onChange(option); setOptions([]); setTerm(""); }}>{option.label}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Panel({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-[0.7rem] font-black uppercase tracking-[0.14em] text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function ToolButton({children, onClick, disabled}: {children: React.ReactNode; onClick: () => void; disabled?: boolean}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40">
      {children}
    </button>
  );
}

function TierRow({label, value, reference, active = false}: {label: string; value: number; reference?: number | null; active?: boolean}) {
  return (
    <tr className={active ? "font-semibold text-slate-950" : "text-slate-600"}>
      <td className="py-0.5 pr-2">{label}</td>
      <td className="py-0.5 text-right">{num(value)}</td>
      <td className="py-0.5 pl-2 text-right text-slate-400">{reference ? diff(percentDifference(value, reference / 100)) : ""}</td>
    </tr>
  );
}

function NumberField({label, value, onNumber, text = false, onText}: {
  label: string;
  value: number | string | null;
  onNumber?: (value: number | null) => void;
  text?: boolean;
  onText?: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-slate-600">
      {label}
      <input
        type={text ? "text" : "number"}
        value={value ?? ""}
        onChange={(event) => {
          if (text) onText?.(event.target.value);
          else onNumber?.(event.target.value === "" ? null : Number(event.target.value));
        }}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
      />
    </label>
  );
}
