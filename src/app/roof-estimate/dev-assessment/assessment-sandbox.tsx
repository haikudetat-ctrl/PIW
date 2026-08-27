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

function getPreviewQuery(search = "") {
  const query = new URLSearchParams(search);
  const presentation = query.get("presentation");
  const result = query.get("result");
  const consultation = query.get("consultation");
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
  };
}

function calculationForPreview(state: ResultPreviewState | null): CalculationState {
  if (state === "ready") {
    return {
      status: "ready",
      source: "google",
      lowCents: 1_800_000,
      highCents: 2_600_000,
      roofSquares: 23,
      generatedAt: "2026-08-26T12:00:00.000Z",
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
  const [resultOverride, setResultOverride] = useState<{
    recommendation: RoofAssessmentRecommendation;
    responses: RoofAssessmentResponses;
  } | null | undefined>(undefined);
  const result = resultOverride === undefined
    ? previewQuery.result ? previewResult : null
    : resultOverride;
  const context = getRoofAssessmentContext(campaign);
  const imageUrl = campaign === "for-every-season" || campaign === "all-season-main"
    ? "/campaigns/every-season.jpg"
    : "/campaigns/roof-above.jpg";

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
        <nav className="absolute bottom-[calc(100%+0.5rem)] right-0 grid min-w-48 overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-2xl" aria-label="Assessment preview campaign">
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
        </nav>
      </details>
      <AssessmentExperience
        key={`${campaign}-${run}`}
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
