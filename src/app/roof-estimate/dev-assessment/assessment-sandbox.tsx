"use client";

import {useEffect, useMemo, useState, useSyncExternalStore} from "react";
import {
  getRoofAssessmentContext,
  type RoofAssessmentPresentationKey,
} from "@/config/roof-assessment";
import {
  calculateRoofAssessment,
  roofAssessmentResponsesSchema,
  type CalculationState,
  type RoofAssessmentRecommendation,
  type RoofAssessmentResponses,
} from "@/domain/roof-assessment";
import {AssessmentExperience} from "../[token]/assessment-experience";
import type {loadAssessmentAerial} from "../[token]/assessment-aerial-loader";
import {AssessmentQuestionnaire} from "../[token]/assessment-questionnaire";
import {AssessmentResult} from "../[token]/assessment-result";

const campaigns: Array<{slug: RoofAssessmentPresentationKey; label: string}> = [
  {slug: "all-season-main", label: "Main website"},
  {slug: "for-every-season", label: "For Every Season"},
  {slug: "weather-report", label: "Weather Report"},
  {slug: "seasonal-shield", label: "Seasonal Shield"},
];

const previewResponses: RoofAssessmentResponses = {
  reason: "known_replacement",
  roofAge: "20_plus",
  conditionSignals: ["curling_or_cracking", "missing_shingles"],
  roofVisible: "yes",
  visibleCondition: "heavy_wear",
  stories: "two",
  complexityFeatures: ["multiple_levels"],
  priority: "long_warranty",
  timeline: "this_season",
  ownership: "owner",
};
const previewResult = {
  recommendation: calculateRoofAssessment(previewResponses).recommendation,
  responses: previewResponses,
};

type ResultPreviewState = CalculationState["status"];
type ConsultationPreviewMode = "success" | "error" | null;
type ImageryPreviewMode = "ready" | "slow" | "retry" | "pending";
const PREVIEW_AERIAL_IMAGE = "/campaigns/seasonal-shield/hero.webp";

export function createPreviewAerialLoader(mode: ImageryPreviewMode): typeof loadAssessmentAerial {
  let attempts = 0;

  return async ({imageSrc, signal}) => {
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    attempts += 1;

    if (mode === "pending" || (mode === "retry" && attempts === 1)) {
      return {kind: "retry", delayMs: 2_500};
    }

    if (mode !== "slow") return {kind: "ready", objectUrl: imageSrc};

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve({kind: "ready", objectUrl: imageSrc});
      }, 9_000);
      const abort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, {once: true});
    });
  };
}

function getPreviewQuery(search = "") {
  const query = new URLSearchParams(search);
  const presentation = query.get("presentation");
  const result = query.get("result");
  const consultation = query.get("consultation");
  const imagery = query.get("imagery");
  return {
    presentation: campaigns.some((item) => item.slug === presentation)
      ? presentation as RoofAssessmentPresentationKey
      : "all-season-main",
    result: (["pending", "ready", "review_required"] as const).includes(
      result as ResultPreviewState,
    ) ? result as ResultPreviewState : null,
    consultation: consultation === "success" || consultation === "error"
      ? consultation as ConsultationPreviewMode
      : null,
    imagery: (["ready", "slow", "retry", "pending"] as const).includes(
      imagery as ImageryPreviewMode,
    ) ? imagery as ImageryPreviewMode : "ready",
  };
}

function calculationForPreview(state: ResultPreviewState | null): CalculationState {
  if (state === "ready") {
    return {
      status: "ready",
      source: "google",
      lowCents: 2_185_000,
      highCents: 2_760_000,
      roofSquares: 23,
      generatedAt: "2026-08-31T12:00:00.000Z",
      pricingVersion: "all-season-nj-2026-v1",
      packages: [
        {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"A dependable complete-system approach focused on sound protection and practical value.",warrantySummary:"Enhanced manufacturer-backed material protection.",differentiators:["Complete roofing system","Architectural finish"],lowCentsPerSquare:80000,highCentsPerSquare:97500,recommended:false,measuredRoofSquares:23,rangeLowCents:1840000,rangeHighCents:2242500,pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"},
        {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"An upgraded system balancing stronger protection, appearance, and long-term confidence.",warrantySummary:"Extended material and workmanship coverage.",differentiators:["Upgraded material weight","Enhanced color depth"],lowCentsPerSquare:95000,highCentsPerSquare:120000,recommended:true,measuredRoofSquares:23,rangeLowCents:2185000,rangeHighCents:2760000,pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"},
        {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"A premium system built around elevated curb appeal, durability, and detailing.",warrantySummary:"Extended workmanship coverage with premium system protection.",differentiators:["Premium dimensional profile","Impact protection"],lowCentsPerSquare:125000,highCentsPerSquare:165000,recommended:false,measuredRoofSquares:23,rangeLowCents:2875000,rangeHighCents:3795000,pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"},
      ],
      adjustments: [
        {code:"decking_sheet",label:"Decking replacement",explanation:"Only where field inspection confirms it is needed.",calculationKind:"per_unit",lowValue:95,highValue:150,displayOrder:1},
        {code:"second_layer",label:"Additional tear-off layer",explanation:"Applies only when another existing layer must be removed.",calculationKind:"per_square",lowValue:75,highValue:125,displayOrder:2},
        {code:"steep_pitch",label:"Steep-roof access",explanation:"Applied after pitch and access conditions are field-confirmed.",calculationKind:"percentage",lowValue:15,highValue:35,displayOrder:3},
      ],
    };
  }
  if (state === "review_required") {
    return {status: "review_required", reason: "low_confidence"};
  }
  return {status: "pending"};
}

export function AssessmentSandbox() {
  const search = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("popstate", onStoreChange);
      return () => window.removeEventListener("popstate", onStoreChange);
    },
    () => window.location.search,
    () => "",
  );
  const previewQuery = useMemo(() => getPreviewQuery(search), [search]);
  const [campaignOverride, setCampaignOverride] = useState<RoofAssessmentPresentationKey | null>(null);
  const campaign = campaignOverride ?? previewQuery.presentation;
  const [run, setRun] = useState(0);
  const [imageryOverride, setImageryOverride] = useState<ImageryPreviewMode | null>(null);
  const [resultOverride, setResultOverride] = useState<{
    recommendation: RoofAssessmentRecommendation;
    responses: RoofAssessmentResponses;
  } | null | undefined>(undefined);
  const result = resultOverride === undefined
    ? previewQuery.result ? previewResult : null
    : resultOverride;
  const context = getRoofAssessmentContext(campaign);
  const imageUrl = PREVIEW_AERIAL_IMAGE;
  const imagery = imageryOverride ?? previewQuery.imagery;
  const imageryFixture = useMemo(() => ({
    key: `${imagery}-${run}`,
    loader: createPreviewAerialLoader(imagery),
  }), [imagery, run]);

  useEffect(() => {
    if (!previewQuery.consultation) return;
    const originalFetch = window.fetch.bind(window);
    const previewFetch: typeof window.fetch = async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!target.endsWith("/consultation")) return originalFetch(input, init);
      if (previewQuery.consultation === "error") {
        return new Response(JSON.stringify({error: "Preview consultation failure"}), {
          status: 503,
          headers: {"content-type": "application/json"},
        });
      }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as {
        contactMethod?: "call" | "text" | "email";
        callWindow?: "asap" | "morning" | "midday" | "afternoon" | "evening" | null;
      } : {};
      return new Response(JSON.stringify({
        status: "requested",
        contactMethod: body.contactMethod,
        callWindow: body.callWindow ?? null,
        timezone: "America/New_York",
      }), {status: 200, headers: {"content-type": "application/json"}});
    };
    window.fetch = previewFetch;
    return () => {
      if (window.fetch === previewFetch) window.fetch = originalFetch;
    };
  }, [previewQuery.consultation]);

  function restart(nextCampaign = campaign) {
    setCampaignOverride(nextCampaign);
    setResultOverride(null);
    setRun((value) => value + 1);
  }

  function previewImagery(nextImagery: ImageryPreviewMode) {
    setImageryOverride(nextImagery);
    setResultOverride(null);
    setRun((value) => value + 1);
  }

  if (result) {
    return (
      <AssessmentResult
        preview
        token="11111111-1111-4111-8111-111111111111"
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl={imageUrl}
        recommendation={result.recommendation}
        responses={result.responses}
        calculation={calculationForPreview(previewQuery.result)}
        context={context}
        onReplay={() => restart()}
      />
    );
  }

  return (
    <div>
      <details className="group fixed bottom-4 right-4 z-50 hidden font-sans sm:block">
        <summary className="cursor-pointer list-none rounded-md border border-slate-300 bg-white/95 px-4 py-3 text-xs font-bold text-slate-800 shadow-xl backdrop-blur marker:hidden">
          Preview campaign
        </summary>
        <nav className="absolute bottom-[calc(100%+0.5rem)] right-0 grid min-w-56 overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-2xl" aria-label="Assessment preview controls">
          <p className="px-3 pb-1 pt-2 text-[0.65rem] font-black uppercase tracking-[0.16em] text-slate-400">Campaign</p>
          {campaigns.map((item) => (
            <button
              key={item.slug}
              type="button"
              aria-pressed={campaign === item.slug}
              onClick={() => restart(item.slug)}
              className="whitespace-nowrap rounded-sm px-3 py-2.5 text-left text-xs font-bold text-slate-600 hover:bg-slate-100 aria-pressed:bg-slate-950 aria-pressed:text-white"
            >
              {item.label}
            </button>
          ))}
          <p className="mt-1 border-t border-slate-200 px-3 pb-1 pt-3 text-[0.65rem] font-black uppercase tracking-[0.16em] text-slate-400">Property imagery</p>
          {([
            ["ready", "Ready"],
            ["slow", "Slow"],
            ["retry", "Retry then ready"],
            ["pending", "Persistent pending"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={imagery === value}
              onClick={() => previewImagery(value)}
              className="whitespace-nowrap rounded-sm px-3 py-2.5 text-left text-xs font-bold text-slate-600 hover:bg-slate-100 aria-pressed:bg-slate-950 aria-pressed:text-white"
            >
              {label}
            </button>
          ))}
        </nav>
      </details>
      <AssessmentExperience
        key={`${campaign}-${imageryFixture.key}`}
        aerialLoader={imageryFixture.loader}
        preview
        token="11111111-1111-4111-8111-111111111111"
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed={false}
        initialStep={0}
      >
        <AssessmentQuestionnaire
          preview
          token="11111111-1111-4111-8111-111111111111"
          address="18 Harbor View Drive, Red Bank, NJ 07701"
          imageUrl={imageUrl}
          initialStep={0}
          initialResponses={{}}
          onPreviewComplete={(responses) => {
            const parsed = roofAssessmentResponsesSchema.safeParse(responses);
            if (parsed.success) {
              setResultOverride({
                recommendation: calculateRoofAssessment(parsed.data).recommendation,
                responses: parsed.data,
              });
            }
          }}
        />
      </AssessmentExperience>
    </div>
  );
}
