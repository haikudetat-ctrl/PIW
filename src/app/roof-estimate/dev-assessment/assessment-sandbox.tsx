"use client";

import {useState} from "react";
import {
  getRoofAssessmentContext,
  type RoofAssessmentCampaignSlug,
} from "@/config/roof-assessment";
import {
  calculateRoofAssessment,
  roofAssessmentResponsesSchema,
  type RoofAssessmentRecommendation,
  type RoofAssessmentResponses,
} from "@/domain/roof-assessment";
import {AssessmentExperience} from "../[token]/assessment-experience";
import {AssessmentQuestionnaire} from "../[token]/assessment-questionnaire";
import {AssessmentResult} from "../[token]/assessment-result";

const campaigns: Array<{slug: RoofAssessmentCampaignSlug; label: string}> = [
  {slug: "for-every-season", label: "Main website"},
  {slug: "do-it-right-once", label: "Do It Right Once"},
  {slug: "weather-report", label: "Weather Report"},
  {slug: "seasonal-shield", label: "Seasonal Shield"},
];

export function AssessmentSandbox() {
  const [campaign, setCampaign] = useState<RoofAssessmentCampaignSlug>("for-every-season");
  const [run, setRun] = useState(0);
  const [result, setResult] = useState<{
    recommendation: RoofAssessmentRecommendation;
    responses: RoofAssessmentResponses;
  } | null>(null);
  const context = getRoofAssessmentContext(campaign);
  const imageUrl = campaign === "for-every-season" || campaign === "do-it-right-once"
    ? "/campaigns/every-season.jpg"
    : "/campaigns/roof-above.jpg";

  function restart(nextCampaign = campaign) {
    setCampaign(nextCampaign);
    setResult(null);
    setRun((value) => value + 1);
  }

  if (result) {
    return (
      <AssessmentResult
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl={imageUrl}
        recommendation={result.recommendation}
        responses={result.responses}
        range={{
          lowCents: 1_800_000,
          highCents: 2_600_000,
          roofSquares: 23,
          source: "sample",
        }}
        consultationHref="tel:+18888325050"
        onReplay={() => restart()}
      />
    );
  }

  return (
    <div>
      <nav className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] gap-1 overflow-x-auto rounded-full border border-slate-300 bg-white/95 p-1.5 shadow-xl backdrop-blur" aria-label="Assessment preview campaign">
        {campaigns.map((item) => (
          <button
            key={item.slug}
            type="button"
            aria-pressed={campaign === item.slug}
            onClick={() => restart(item.slug)}
            className="whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold text-slate-600 aria-pressed:bg-slate-950 aria-pressed:text-white"
          >
            {item.label}
          </button>
        ))}
      </nav>
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
          initialStep={0}
          initialResponses={{}}
          onPreviewComplete={(responses) => {
            const parsed = roofAssessmentResponsesSchema.safeParse(responses);
            if (parsed.success) {
              setResult({
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
